import CarPlay
import Observation

@MainActor
final class CarPlayController: NSObject, @preconcurrency CPNowPlayingTemplateObserver, CPInterfaceControllerDelegate {
    enum Screen: Hashable {
        case queue, library, downloads, starred, listening, podcasts
        case podcast(Podcast)

        var title: String {
            switch self {
            case .queue: String(localized: "Queue")
            case .library: String(localized: "Library")
            case .downloads: String(localized: "Downloads")
            case .starred: String(localized: "Starred")
            case .listening: String(localized: "Continue & new")
            case .podcasts: String(localized: "Subscriptions")
            case .podcast(let podcast): podcast.title
            }
        }

        var image: String {
            switch self {
            case .queue: "text.line.first.and.arrowtriangle.forward"
            case .library: "square.grid.2x2"
            case .downloads: "arrow.down.circle"
            case .starred: "star"
            case .listening: "play.circle"
            case .podcasts, .podcast: "mic"
            }
        }
    }

    private enum Row: Equatable {
        case destination(Screen)
        case episode(Episode)
        case more(enabled: Bool)
        case message(String)
    }

    private struct Contents: Equatable {
        let scope: UUID
        var rows: [Row] = []
        var title = String(localized: "No episodes")
        var subtitle: String?
    }

    private final class Page {
        let screen: Screen
        let template: CPListTemplate
        var contents: Contents?
        var episodes: [(Episode, CPListItem)] = []
        var artwork: [Task<Void, Never>] = []

        init(screen: Screen, template: CPListTemplate) {
            self.screen = screen
            self.template = template
        }

        func cancelArtwork() {
            artwork.forEach { $0.cancel() }
            artwork.removeAll()
        }
    }

    private let app: AppModel
    private var interface: CPInterfaceController?
    private var root: CPTabBarTemplate?
    private var pages: [Page] = []
    private var podcastStore: PodcastDetailStore?
    private var podcastScreen: Screen?
    private var contentTask: Task<Void, Never>?
    private var refreshTask: (id: UUID, task: Task<Void, Never>)?
    private var connection = UUID()
    private var observation = UUID()
    private var scope: UUID?
    private var wasLoading = false
    private var selection: (identity: String, completion: () -> Void)?

    init(app: AppModel) { self.app = app }

    func connect(_ interface: CPInterfaceController) {
        if self.interface != nil { disconnect() }
        self.interface = interface
        interface.delegate = self
        scope = app.api.activityToken
        let nowPlaying = CPNowPlayingTemplate.shared
        nowPlaying.add(self)
        nowPlaying.isUpNextButtonEnabled = true
        nowPlaying.upNextTitle = String(localized: "Queue")
        nowPlaying.isAlbumArtistButtonEnabled = false
        nowPlaying.updateNowPlayingButtons([])
        let tabs: [Screen] = [.queue, .library, .downloads, .starred]
        root = CPTabBarTemplate(templates: tabs.prefix(CPTabBarTemplate.maximumTabCount).map(makeTemplate))
        if let root { interface.setRootTemplate(root, animated: false) { _, _ in } }
        observe()
    }

    func disconnect() {
        connection = UUID()
        contentTask?.cancel()
        refreshTask?.task.cancel()
        refreshTask = nil
        pages.forEach { $0.cancelArtwork() }
        completeSelection()
        CPNowPlayingTemplate.shared.remove(self)
        interface?.delegate = nil
        interface = nil
        root = nil
        pages.removeAll()
        podcastStore = nil
        podcastScreen = nil
    }

    func episodes(for screen: Screen) -> [Episode] {
        guard canBrowse else { return [] }
        switch screen {
        case .queue:
            return (app.playback.currentEpisode.map { [$0] } ?? []) + app.playback.upNext
        case .downloads:
            return app.media.downloadedEpisodes.filter {
                if case .available = app.media.status(for: $0) { true } else { false }
            }
        case .starred:
            return app.stars.episodes
        case .listening:
            let current = app.library.continuingEpisode(app.playback.currentEpisode, position: app.playback.currentTime)
            var seen = Set<String>()
            return ((current.map { [$0] } ?? []) + app.library.newReleases).filter {
                app.library.progress(for: $0)?.completed != true && seen.insert($0.identity).inserted
            }
        case .podcast(let podcast):
            guard podcastStore?.scope == app.api.activityToken,
                  podcastScreen == screen else { return podcast.episodes }
            return podcastStore?.episodes ?? []
        case .library, .podcasts:
            return []
        }
    }

    @discardableResult
    func play(_ episode: Episode, scope: UUID) -> Bool {
        guard canBrowse, app.api.activityToken == scope, !app.playback.queueStorageBlocked else { return false }
        if app.playback.currentEpisode?.identity == episode.identity, app.playback.clip == nil {
            app.playback.resume()
        } else {
            let progress = app.library.progress(for: episode)
            app.playback.play(episode, at: progress?.completed == true ? 0 : progress?.position ?? 0)
        }
        return app.playback.currentEpisode?.identity == episode.identity && app.playback.isPlaybackRequested
    }

    private var canBrowse: Bool {
        !app.session.isLoading && app.session.accountWorkAllowed && app.media.accountID == app.session.user?.id
    }

    private func isCurrent(_ token: UUID, scope: UUID) -> Bool {
        interface != nil && connection == token && app.api.activityToken == scope && canBrowse
    }

    private func makeTemplate(_ screen: Screen) -> CPListTemplate {
        let template = CPListTemplate(title: screen.title, sections: [])
        template.tabTitle = screen.title
        template.tabImage = UIImage(systemName: screen.image)
        template.emptyViewTitleVariants = [String(localized: "No episodes")]
        pages.append(Page(screen: screen, template: template))
        return template
    }

    private func observe() {
        guard interface != nil else { return }
        let token = connection
        let observation = UUID()
        self.observation = observation
        withObservationTracking {
            update()
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self, self.connection == token, self.observation == observation else { return }
                self.observe()
            }
        }
    }

    private func update() {
        if scope != app.api.activityToken || (app.session.isLoading && !wasLoading) {
            scope = app.api.activityToken
            contentTask?.cancel()
            refreshTask?.task.cancel()
            refreshTask = nil
            podcastStore = nil
            podcastScreen = nil
            completeSelection()
            if let root {
                removePages { page in !root.templates.contains { $0 === page.template } }
                interface?.popToRootTemplate(animated: false) { _, _ in }
            }
        }
        wasLoading = app.session.isLoading
        for page in pages { update(page) }
        if let selection {
            if app.playback.currentEpisode?.identity != selection.identity || !canBrowse {
                completeSelection()
            } else if app.playback.state == .playing {
                completeSelection()
                showNowPlaying()
            } else if app.playback.state == .failed {
                completeSelection()
                showError(String(localized: "Unable to play this episode"))
            } else if !app.playback.isPlaybackRequested {
                completeSelection()
            }
        }
    }

    private func update(_ page: Page) {
        let contents = contents(for: page.screen)
        if page.contents != contents {
            page.cancelArtwork()
            page.episodes = []
            page.contents = contents
            page.template.emptyViewTitleVariants = [contents.title]
            page.template.emptyViewSubtitleVariants = contents.subtitle.map { [$0] } ?? []
            let token = connection
            let scope = app.api.activityToken
            page.template.trailingNavigationBarButtons = [CPBarButton(image: UIImage(systemName: "arrow.clockwise")!) { [weak self, weak page] _ in
                guard let self, let page, self.isCurrent(token, scope: scope) else { return }
                self.refresh(page.screen)
            }]
            let items = contents.rows.map { makeItem($0, page: page) }
            page.template.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
        }
        for (episode, item) in page.episodes {
            let progress = app.library.progress(for: episode)
            let position = app.playback.position(of: episode) ?? progress?.position ?? 0
            let duration = episode.duration ?? 0
            let fraction = progress?.completed == true ? 1 : CGFloat(duration > 0 ? min(1, max(0, position / duration)) : 0)
            let playing = app.playback.currentEpisode?.identity == episode.identity && app.playback.isPlaying
            if item.isPlaying != playing { item.isPlaying = playing }
            let displayedProgress = floor(fraction * 100) / 100
            if item.playbackProgress != displayedProgress { item.playbackProgress = displayedProgress }
        }
    }

    private func contents(for screen: Screen) -> Contents {
        var contents = Contents(scope: app.api.activityToken)
        guard canBrowse else {
            contents.title = app.session.isLoading ? String(localized: "Loading your library") : String(localized: "Library unavailable")
            return contents
        }
        let limit = CPListTemplate.maximumItemCount
        switch screen {
        case .library:
            contents.rows = [.destination(.listening), .destination(.podcasts)]
        case .podcasts:
            contents.rows = app.library.podcasts.prefix(limit).map { .destination(.podcast($0)) }
            contents.title = String(localized: "No subscriptions")
        default:
            contents.rows = episodes(for: screen).prefix(limit).map(Row.episode)
        }
        if case .podcast = screen, podcastScreen == screen, let store = podcastStore {
            if store.hasMore, contents.rows.count < limit {
                contents.rows.append(.more(enabled: !store.isLoading && !store.isLoadingMore))
            }
            if store.loadFailed || store.moreFailed {
                contents.title = String(localized: "Episodes unavailable")
                contents.subtitle = String(localized: "Try refreshing")
                if !contents.rows.isEmpty, contents.rows.count < limit {
                    contents.rows.append(.message(String(localized: "Some episodes could not be loaded. Try refreshing.")))
                }
            } else if contents.rows.isEmpty, store.isLoading {
                contents.title = String(localized: "Loading episodes")
            }
        } else if contents.rows.isEmpty {
            switch screen {
            case .queue: contents.title = String(localized: "Your queue is empty")
            case .downloads: contents.title = String(localized: "No downloaded episodes")
            case .starred:
                contents.title = app.stars.error == nil ? String(localized: "No starred episodes") : String(localized: "Starred episodes unavailable")
            case .listening, .podcasts:
                if app.library.syncError != nil {
                    contents.title = String(localized: "Library unavailable")
                    contents.subtitle = String(localized: "Try refreshing")
                }
            default: break
            }
        }
        contents.rows = Array(contents.rows.prefix(limit))
        return contents
    }

    private func makeItem(_ row: Row, page: Page) -> CPListItem {
        let token = connection
        let scope = app.api.activityToken
        switch row {
        case .destination(let screen):
            let item: CPListItem
            if case .podcast(let podcast) = screen {
                item = CPListItem(text: podcast.title, detailText: podcast.author)
                loadArtwork(podcast.artworkURL, into: item, page: page)
            } else {
                item = CPListItem(text: screen.title, detailText: nil, image: UIImage(systemName: screen.image))
            }
            item.accessoryType = .disclosureIndicator
            item.handler = { [weak self] _, completion in
                defer { completion() }
                guard let self, self.isCurrent(token, scope: scope) else { return }
                self.open(screen)
            }
            return item
        case .episode(let episode):
            let item = episodeItem(episode)
            page.episodes.append((episode, item))
            loadArtwork(episode.artworkURL, into: item, page: page)
            return item
        case .message(let message):
            let item = CPListItem(text: message, detailText: nil)
            item.isEnabled = false
            return item
        case .more(let enabled):
            let item = CPListItem(text: String(localized: "More episodes"), detailText: nil)
            item.isEnabled = enabled
            item.handler = { [weak self, weak page] _, completion in
                guard let self, let page, self.isCurrent(token, scope: scope), let store = self.podcastStore,
                      self.podcastScreen == page.screen else { completion(); return }
                self.contentTask?.cancel()
                self.contentTask = Task {
                    defer { completion() }
                    await store.loadMore(api: self.app.api)
                    guard !Task.isCancelled, self.isCurrent(token, scope: scope) else { return }
                    await self.app.library.loadProgress(for: store.episodes)
                }
            }
            return item
        }
    }

    private func episodeItem(_ episode: Episode) -> CPListItem {
        let item = CPListItem(text: episode.title, detailText: episode.podcastTitle)
        item.isExplicitContent = episode.explicit
        let token = connection
        let scope = app.api.activityToken
        item.handler = { [weak self] _, completion in
            guard let self, self.isCurrent(token, scope: scope) else { completion(); return }
            self.completeSelection()
            guard self.play(episode, scope: scope) else {
                completion()
                if self.isCurrent(token, scope: scope) { self.showError(String(localized: "Playback unavailable")) }
                return
            }
            if self.app.playback.isPlaying {
                completion()
                self.showNowPlaying()
            } else {
                self.selection = (episode.identity, completion)
            }
        }
        return item
    }

    private func loadArtwork(_ url: URL?, into item: CPListItem, page: Page) {
        guard let url, let interface else { return }
        let token = connection
        let scope = app.api.activityToken
        let size = Int(CPListItem.maximumImageSize.width * interface.carTraitCollection.displayScale)
        page.artwork.append(Task { [weak self, weak item] in
            let image = await ArtworkStore.shared.image(url, pixelSize: max(1, size))
            guard !Task.isCancelled, let self, self.isCurrent(token, scope: scope) else { return }
            item?.setImage(image)
        })
    }

    private func removePages(where predicate: (Page) -> Bool) {
        pages.removeAll { page in
            guard predicate(page) else { return false }
            page.cancelArtwork()
            return true
        }
    }

    private func open(_ screen: Screen) {
        guard canBrowse, let interface else { return }
        let template = makeTemplate(screen)
        if case .podcast = screen { refresh(screen) }
        else if screen == .listening { refresh(screen) }
        observe()
        interface.pushTemplate(template, animated: true) { [weak self] success, _ in
            if !success { self?.removePages { $0.template === template } }
        }
    }

    private func refresh(_ screen: Screen) {
        guard canBrowse, interface != nil else { return }
        let token = connection
        let scope = app.api.activityToken
        if case .podcast(let podcast) = screen {
            let store = podcastScreen == screen ? podcastStore ?? PodcastDetailStore() : PodcastDetailStore()
            podcastStore = store
            podcastScreen = screen
            contentTask?.cancel()
            contentTask = Task { [weak self] in
                guard let self else { return }
                await store.load(podcast, api: self.app.api)
                guard !Task.isCancelled, self.isCurrent(token, scope: scope) else { return }
                await self.app.library.loadProgress(for: store.episodes)
            }
            observe()
            return
        }
        guard refreshTask == nil else { return }
        let id = UUID()
        let task = Task { [weak self] in
            guard let self else { return }
            defer { if self.refreshTask?.id == id { self.refreshTask = nil } }
            await self.app.refresh()
            guard !Task.isCancelled, self.isCurrent(token, scope: scope) else { return }
            await self.app.library.loadProgress(for: self.episodes(for: screen))
        }
        refreshTask = (id, task)
    }

    private func completeSelection() {
        let completion = selection?.completion
        selection = nil
        completion?()
    }

    private func showNowPlaying() {
        guard let interface, app.playback.isActive, interface.topTemplate !== CPNowPlayingTemplate.shared else { return }
        if interface.templates.contains(where: { $0 === CPNowPlayingTemplate.shared }) {
            interface.pop(to: CPNowPlayingTemplate.shared, animated: true) { _, _ in }
        } else {
            interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true) { _, _ in }
        }
    }

    private func showError(_ message: String) {
        guard let interface else { return }
        let token = connection
        let action = CPAlertAction(title: String(localized: "OK"), style: .default) { [weak self] _ in
            guard let self, self.connection == token else { return }
            self.interface?.dismissTemplate(animated: true) { _, _ in }
        }
        interface.presentTemplate(CPAlertTemplate(titleVariants: [message], actions: [action]), animated: true) { _, _ in }
    }

    func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        guard canBrowse, let root, let queue = pages.first(where: { $0.screen == .queue })?.template else { return }
        let token = connection
        let scope = app.api.activityToken
        interface?.popToRootTemplate(animated: true) { [weak self] success, _ in
            if success, self?.isCurrent(token, scope: scope) == true { root.select(queue) }
        }
    }

    func templateDidAppear(_ aTemplate: CPTemplate, animated: Bool) {
        guard let interface, let root else { return }
        let visible = interface.templates + root.templates
        removePages { page in !visible.contains { $0 === page.template } }
        if !pages.contains(where: { if case .podcast = $0.screen { true } else { false } }) {
            contentTask?.cancel()
            podcastStore = nil
            podcastScreen = nil
        }
    }
}
