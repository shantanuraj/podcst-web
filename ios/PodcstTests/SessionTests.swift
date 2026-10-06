import Foundation
import XCTest
@testable import Podcst

@MainActor
final class SessionTests: XCTestCase {
    func testOnboardingChartsSurviveGuestSessionRestoration() async throws {
        let fixture = try await guestFixture(podcasts: [], restoreSession: false)
        defer { fixture.cleanUp() }
        let locale = "onboarding-\(UUID().uuidString.lowercased())"
        defer { PodcastSnapshotCache(namespace: "top", lifetime: 3600).remove("\(locale)-30") }
        let podcast = Podcast(id: 9201, feed: "https://example.test/onboarding", title: "Onboarding show", cover: "https://example.test/onboarding.jpg")
        let started = expectation(description: "Onboarding chart request started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/top":
                pending = request
                started.fulfill()
            case "/api/auth/session":
                try request.respond(["user": Optional<User>.none])
            default:
                XCTFail("Unexpected onboarding request")
                request.fail(URLError(.unsupportedURL))
            }
        }

        let charts = Task { try await fixture.api.top(locale: locale) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.session.restore()
        XCTAssertNil(fixture.session.user)
        XCTAssertFalse(fixture.session.isLoading)
        try XCTUnwrap(pending).respond([podcast])

        let result = try await charts.value
        XCTAssertEqual(result, [podcast])
        XCTAssertEqual(fixture.api.cachedTop(locale: locale), [podcast])
    }

    func testPublicChartsDoNotSendOrAcceptSessionCredentials() async throws {
        let credentials = MemorySessionCredentials()
        credentials.write("listener-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestLibraryURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://charts.example.test")!, session: URLSession(configuration: configuration), keychain: credentials)
        defer { api.clearSession(); GuestLibraryURLProtocol.handler = nil }
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/top")
            XCTAssertNil(request.request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertFalse(request.request.httpShouldHandleCookies)
            try request.respond([Podcast](), headers: ["Set-Cookie": "session=unexpected-session; Path=/; HttpOnly"])
        }

        let locale = "credentials-\(UUID().uuidString.lowercased())"
        defer { PodcastSnapshotCache(namespace: "top", lifetime: 3600).remove("\(locale)-30") }
        let charts = try await api.top(locale: locale)

        XCTAssertTrue(charts.isEmpty)
        XCTAssertEqual(credentials.read(), "listener-session")
    }

    func testRetiredAccountResponseCannotRestoreCredentials() async throws {
        let credentials = MemorySessionCredentials()
        credentials.write("listener-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestLibraryURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://progress.example.test")!, session: URLSession(configuration: configuration), keychain: credentials)
        defer { api.clearSession(); GuestLibraryURLProtocol.handler = nil }
        let started = expectation(description: "Authenticated progress request started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/progress")
            XCTAssertEqual(request.request.value(forHTTPHeaderField: "Cookie"), "session=listener-session")
            pending = request
            started.fulfill()
        }

        let progress = Task { try await api.currentProgress() }
        await fulfillment(of: [started], timeout: 2)
        api.clearSession()
        try XCTUnwrap(pending).respond(Optional<PlaybackProgress>.none, headers: ["Set-Cookie": "session=retired-session; Path=/; HttpOnly"])

        do {
            _ = try await progress.value
            XCTFail("Retired account responses must be rejected")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertNil(credentials.read())
        XCTAssertFalse(api.hasSession)
    }

    func testCachedAccountSurvivesOfflineRestoreAndSignsOutOffline() async throws {
        let fixture = try fixture()
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        XCTAssertEqual(session.user?.id, "listener")
        XCTAssertEqual(fixture.api.accountID, "listener")
        await session.restore()
        XCTAssertEqual(session.user?.id, "listener")
        var transitions: [String?] = []
        session.prepareAccountChange = { transitions.append($0) }
        await session.signOut()
        XCTAssertNil(session.user)
        XCTAssertNil(fixture.api.accountID)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertEqual(transitions.count, 1)
        XCTAssertNil(transitions.first ?? nil)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.url.path))
        XCTAssertNil(SessionStore(api: fixture.api, storageURL: fixture.url).user)
    }

    func testAuthoritativeSessionExpiryClearsCachedAccountAfterResourceRetirement() async throws {
        let fixture = try fixture(status: 401)
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        var retired = false
        session.prepareAccountChange = { id in
            XCTAssertNil(id)
            XCTAssertEqual(session.user?.id, "listener")
            retired = true
        }
        await session.restore()
        XCTAssertTrue(retired)
        XCTAssertNil(session.user)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.url.path))
    }

    func testSignOutCancelsAnUnresponsiveStartupRestore() async throws {
        let fixture = try fixture(status: 999)
        defer { fixture.cleanUp() }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        let started = expectation(forNotification: Notification.Name("SessionTestRequestStarted"), object: nil)
        let restore = Task { await session.restore() }
        await fulfillment(of: [started], timeout: 2)
        await session.signOut()
        await restore.value
        XCTAssertNil(session.user)
        XCTAssertFalse(fixture.api.hasSession)
        XCTAssertFalse(session.isLoading)
    }

    func testUserSnapshotAloneDoesNotRestoreAuthentication() throws {
        let fixture = try fixture()
        defer { fixture.cleanUp() }
        fixture.keychain.delete()
        let api = APIClient(keychain: fixture.keychain)
        XCTAssertNil(SessionStore(api: api, storageURL: fixture.url).user)
        XCTAssertNil(api.accountID)
    }

    func testLibraryWaitsForAccountRestoreWhenOnlyCredentialsRemain() async throws {
        let fixture = try fixture(status: 200)
        defer { fixture.api.clearSession(); fixture.cleanUp() }
        try FileManager.default.removeItem(at: fixture.url)
        let defaultsName = "LibraryBootstrap-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: defaultsName)!
        defer { defaults.removePersistentDomain(forName: defaultsName) }
        let session = SessionStore(api: fixture.api, storageURL: fixture.url)
        let library = LibraryStore(api: fixture.api, session: session, defaults: defaults)

        XCTAssertTrue(fixture.api.hasSession)
        XCTAssertNil(session.user)
        XCTAssertTrue(session.isLoading)
        XCTAssertFalse(library.hasLoaded)
        await library.load()
        XCTAssertFalse(library.hasLoaded)
        XCTAssertTrue(library.podcasts.isEmpty)

        await session.restore()
        XCTAssertEqual(session.user?.id, "listener")
        XCTAssertFalse(session.isLoading)
        XCTAssertFalse(library.hasLoaded)
        await library.load(forceRefresh: true)
        XCTAssertTrue(library.hasLoaded)
        XCTAssertEqual(library.podcasts.map(\.title), ["Restored show"])
        XCTAssertEqual(library.newReleases.map(\.title), ["Restored episode"])
    }

    func testGuestLoadFetchesLatestEpisodesForSavedSubscriptions() async throws {
        let podcasts = (9071...9073).map { (id: Int) in
            Podcast(id: id, feed: "https://example.test/\(id)", title: "Show \(id)")
        }
        let episodes = podcasts.enumerated().map { index, podcast in
            [release(6 - index, podcast: podcast), release(3 - index, podcast: podcast)]
        }
        let fixture = try await guestFixture(podcasts: podcasts)
        defer { fixture.cleanUp() }
        var requestedIDs: [Int] = []
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/feed/episodes")
            XCTAssertEqual(request.request.httpMethod, "GET")
            let query = try XCTUnwrap(URLComponents(url: XCTUnwrap(request.request.url), resolvingAgainstBaseURL: false)?.queryItems)
            XCTAssertEqual(query.first { $0.name == "limit" }?.value, "2")
            XCTAssertEqual(query.first { $0.name == "sortBy" }?.value, "published")
            XCTAssertEqual(query.first { $0.name == "sortDir" }?.value, "desc")
            let id = try XCTUnwrap(query.first { $0.name == "podcastId" }?.value.flatMap(Int.init))
            let index = try XCTUnwrap(podcasts.firstIndex { $0.id == id })
            requestedIDs.append(id)
            try request.respond(EpisodePage(episodes: episodes[index], total: 100 + index, hasMore: true, nextCursor: 2))
        }

        XCTAssertTrue(fixture.library.newReleases.isEmpty)
        await fixture.library.load()

        XCTAssertEqual(Set(requestedIDs), Set(podcasts.compactMap(\.id)))
        XCTAssertEqual(requestedIDs.count, 3)
        XCTAssertEqual(fixture.library.newReleases, episodes.flatMap { $0 }.sorted { $0.published! > $1.published! })
        XCTAssertEqual(fixture.library.podcasts.map(\.episodeCount), [100, 101, 102])
        XCTAssertNil(fixture.library.error)
        XCTAssertFalse(fixture.library.isLoading)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
        XCTAssertEqual(restored.newReleases, fixture.library.newReleases)
    }

    func testNewReleasesSelectsTwoNewestEpisodesPerShowBeforeGlobalSorting() async throws {
        var first = Podcast(id: 9081, feed: "https://example.test/first", title: "First show")
        var second = Podcast(id: 9082, feed: "https://example.test/second", title: "Second show")
        first.episodes = [1, 4, 7].map { release($0, podcast: first) }
        second.episodes = [6, 2, 5].map { release($0, podcast: second) }
        let fixture = try await guestFixture(podcasts: [first, second])
        defer { fixture.cleanUp() }

        XCTAssertEqual(fixture.library.newReleases.map(\.title), [7, 6, 5, 4].map { "Episode \($0)" })
        XCTAssertEqual(fixture.library.podcasts, [first, second])
    }

    func testGuestFeedSubscriptionPersistsBeforeResolvingItsEpisodes() async throws {
        let original = Podcast(feed: "https://example.test/\(UUID().uuidString)", title: "Search result")
        var resolved = original
        resolved.id = 9091
        resolved.title = "Resolved show"
        resolved.episodeCount = 3
        resolved.episodes = [2, 1, 3].map { release($0, podcast: resolved) }
        let fixture = try await guestFixture(podcasts: [])
        defer { fixture.cleanUp() }
        let started = expectation(description: "Guest feed resolution started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/feed")
            XCTAssertEqual(request.request.httpMethod, "GET")
            let query = try XCTUnwrap(URLComponents(url: XCTUnwrap(request.request.url), resolvingAgainstBaseURL: false)?.queryItems)
            XCTAssertEqual(query.first { $0.name == "url" }?.value, original.feed)
            pending = request
            started.fulfill()
        }

        let subscription = Task { await fixture.library.toggleSubscription(original) }
        await fulfillment(of: [started], timeout: 2)
        let saved = try XCTUnwrap(fixture.defaults.data(forKey: "guest.library.podcasts"))
        XCTAssertEqual(try JSONDecoder().decode([Podcast].self, from: saved), [original])
        try XCTUnwrap(pending).respond(resolved)
        await subscription.value

        XCTAssertEqual(fixture.library.podcasts, [resolved])
        XCTAssertEqual(fixture.library.newReleases.map(\.title), ["Episode 3", "Episode 2"])
        XCTAssertNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, [resolved])
    }

    func testGuestLoadRetainsCachedEpisodesWhenOneShowIsUnavailable() async throws {
        var unavailable = Podcast(id: 9101, feed: "https://example.test/unavailable-cached", title: "Cached show")
        unavailable.episodes = [release(1, podcast: unavailable)]
        let available = Podcast(id: 9102, feed: "https://example.test/available", title: "Available show")
        let updatedEpisodes = [3, 2].map { release($0, podcast: available) }
        let fixture = try await guestFixture(podcasts: [unavailable, available])
        defer { fixture.cleanUp() }
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/feed/episodes")
            let query = try XCTUnwrap(URLComponents(url: XCTUnwrap(request.request.url), resolvingAgainstBaseURL: false)?.queryItems)
            if query.first(where: { $0.name == "podcastId" })?.value == "9101" {
                request.fail(URLError(.notConnectedToInternet))
            } else {
                try request.respond(EpisodePage(episodes: updatedEpisodes, total: 10, hasMore: true))
            }
        }

        await fixture.library.load()

        XCTAssertEqual(fixture.library.podcasts.first, unavailable)
        XCTAssertEqual(fixture.library.podcasts.last?.episodes, updatedEpisodes)
        XCTAssertEqual(fixture.library.newReleases.map(\.title), ["Episode 3", "Episode 2", "Episode 1"])
        XCTAssertNotNil(fixture.library.error)
        XCTAssertFalse(fixture.library.isLoading)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
    }

    func testGuestSubscriptionRemainsSavedWhenEpisodeLoadFailsAndRemovalNeedsNoRequest() async throws {
        let podcast = Podcast(id: 9111, feed: "https://example.test/new-subscription", title: "New subscription")
        let fixture = try await guestFixture(podcasts: [])
        defer { fixture.cleanUp() }
        var requests = 0
        GuestLibraryURLProtocol.handler = { request in
            requests += 1
            XCTAssertEqual(request.request.url?.path, "/api/feed/episodes")
            request.fail(URLError(.notConnectedToInternet))
        }

        await fixture.library.toggleSubscription(podcast)

        XCTAssertEqual(requests, 1)
        XCTAssertEqual(fixture.library.podcasts, [podcast])
        XCTAssertNotNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, [podcast])

        await fixture.library.toggleSubscription(podcast)

        XCTAssertEqual(requests, 1)
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        XCTAssertNil(fixture.library.error)
        let removed = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertTrue(removed.podcasts.isEmpty)
    }

    func testGuestRefreshPersistsUpdatedEpisodesAndRetainsUnavailableShows() async throws {
        let unavailable = Podcast(id: 9031, feed: "https://example.test/unavailable", title: "Unavailable show")
        let original = Podcast(id: 9032, feed: "https://example.test/updated", title: "Original show")
        let episode = Episode(guid: "new", feed: original.feed, title: "New episode", file: EpisodeFile(url: "https://example.test/new.mp3"))
        let updated = Podcast(id: original.id, feed: original.feed, title: "Updated show", episodeCount: 1, episodes: [episode])
        let fixture = try await guestFixture(podcasts: [unavailable, original])
        defer { fixture.cleanUp() }
        var requests = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/feed/refresh")
            XCTAssertEqual(request.request.httpMethod, "POST")
            requests += 1
            if requests == 1 {
                request.fail(URLError(.notConnectedToInternet))
            } else {
                try request.respond(updated)
            }
        }

        await fixture.library.load(forceRefresh: true)

        XCTAssertEqual(requests, 2)
        XCTAssertEqual(fixture.library.podcasts.map(\.title), [unavailable.title, updated.title])
        XCTAssertEqual(fixture.library.newReleases.map(\.title), [episode.title])
        XCTAssertNotNil(fixture.library.error)
        XCTAssertFalse(fixture.library.isLoading)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
    }

    func testGuestRefreshPreservesSubscriptionChangesDuringRequests() async throws {
        let removed = Podcast(id: 9041, feed: "https://example.test/removed", title: "Removed show")
        let kept = Podcast(id: 9042, feed: "https://example.test/kept", title: "Kept show")
        let added = Podcast(id: 9043, feed: "https://example.test/added", title: "Added show")
        var updated = kept
        updated.title = "Updated kept show"
        let fixture = try await guestFixture(podcasts: [removed, kept])
        defer { fixture.cleanUp() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if request.request.url?.path == "/api/feed/episodes" {
                try request.respond(EpisodePage(episodes: [], total: 0, hasMore: false))
            } else if pending == nil {
                pending = request
                started.fulfill()
            } else {
                try request.respond(updated)
            }
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.library.toggleSubscription(removed)
        await fixture.library.toggleSubscription(added)
        try XCTUnwrap(pending).respond(removed)
        await refresh.value

        XCTAssertEqual(fixture.library.podcasts.map(\.title), [updated.title, added.title])
        XCTAssertNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, fixture.library.podcasts)
    }

    func testCancelledGuestRefreshDoesNotReplaceSavedPodcasts() async throws {
        let original = Podcast(id: 9051, feed: "https://example.test/cancelled", title: "Original show")
        var updated = original
        updated.title = "Updated show"
        let fixture = try await guestFixture(podcasts: [original])
        defer { fixture.cleanUp() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            pending = request
            started.fulfill()
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        refresh.cancel()
        try XCTUnwrap(pending).respond(updated)
        await refresh.value

        XCTAssertEqual(fixture.library.podcasts, [original])
        XCTAssertNil(fixture.library.error)
        let restored = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults)
        XCTAssertEqual(restored.podcasts, [original])
    }

    func testGuestRefreshDoesNotApplyAfterAccountRestore() async throws {
        let original = Podcast(id: 9061, feed: "https://example.test/account-change", title: "Guest show")
        let fixture = try await guestFixture(podcasts: [original])
        defer { fixture.cleanUp() }
        fixture.session.prepareAccountChange = { _ in await fixture.library.resetProgressSync() }
        let started = expectation(description: "Guest refresh started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if request.request.url?.path == "/api/auth/session" {
                try request.respond(["user": User(id: "new-listener", email: "new@example.test")])
            } else {
                pending = request
                started.fulfill()
            }
        }

        let refresh = Task { await fixture.library.load(forceRefresh: true) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.session.restore()
        try XCTUnwrap(pending).respond(original)
        await refresh.value

        XCTAssertEqual(fixture.session.user?.id, "new-listener")
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        let saved = try XCTUnwrap(fixture.defaults.data(forKey: "guest.library.podcasts"))
        XCTAssertEqual(try JSONDecoder().decode([Podcast].self, from: saved), [original])
    }

    func testGuestSubscriptionFailureDoesNotChangeRestoredAccount() async throws {
        let original = Podcast(id: 9121, feed: "https://example.test/subscription-account-change", title: "Guest subscription")
        let fixture = try await guestFixture(podcasts: [])
        defer { fixture.cleanUp() }
        fixture.session.prepareAccountChange = { _ in await fixture.library.resetProgressSync() }
        let started = expectation(description: "Guest subscription started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if request.request.url?.path == "/api/auth/session" {
                try request.respond(["user": User(id: "new-listener", email: "new@example.test")])
            } else {
                pending = request
                started.fulfill()
            }
        }

        let subscription = Task { await fixture.library.toggleSubscription(original) }
        await fulfillment(of: [started], timeout: 2)
        await fixture.session.restore()
        try XCTUnwrap(pending).fail(URLError(.notConnectedToInternet))
        await subscription.value

        XCTAssertEqual(fixture.session.user?.id, "new-listener")
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        XCTAssertNil(fixture.library.error)
        let saved = try XCTUnwrap(fixture.defaults.data(forKey: "guest.library.podcasts"))
        XCTAssertEqual(try JSONDecoder().decode([Podcast].self, from: saved), [original])
    }

    func testSharingUsesOnlyDeclaredPublicWebpages() {
        let feed = "https://example.test/private-feed?token=feed-secret"
        let audio = "https://example.test/audio.mp3?token=audio-secret"
        var episode = Episode(guid: "private", feed: feed, title: "Private episode", file: EpisodeFile(url: audio))
        var podcast = Podcast(feed: feed, title: "Private podcast")
        XCTAssertNil(episode.shareURL)
        XCTAssertNil(podcast.shareURL)
        for link in [feed, audio, "file:///tmp/audio.mp3", "https://listener:secret@example.test/episode", "/episode"] {
            episode.link = link
            XCTAssertNil(episode.shareURL)
        }
        for link in [feed, "file:///tmp/feed.xml", "https://listener:secret@example.test/show", "/show"] {
            podcast.link = link
            XCTAssertNil(podcast.shareURL)
        }
        episode.link = "https://example.test/episode"
        podcast.link = "https://example.test/show"
        XCTAssertEqual(episode.shareURL?.absoluteString, episode.link)
        XCTAssertEqual(podcast.shareURL?.absoluteString, podcast.link)
    }

    func testForegroundProgressFlushRetriesWithoutReloadingLibraryOrPlayback() async throws {
        let fixture = try await guestFixture(podcasts: [])
        defer { fixture.cleanUp() }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let library = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults, progressDirectory: directory)
        GuestLibraryURLProtocol.handler = { request in
            try request.respond(["user": User(id: "listener", email: "listener@example.test")])
        }
        await fixture.session.restore()
        var offlineRequests = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.httpMethod, "PUT")
            XCTAssertEqual(request.request.url?.path, "/api/progress")
            offlineRequests += 1
            request.fail(URLError(.notConnectedToInternet))
        }
        let episode = Episode(id: 42, guid: "downloaded", feed: "https://example.test/feed", title: "Downloaded", file: EpisodeFile(url: "https://example.test/audio.mp3"))
        library.saveProgress(.init(episode: episode, position: 123, completed: false))
        await library.flushProgress()
        XCTAssertGreaterThan(offlineRequests, 0)
        XCTAssertNotNil(library.error)
        var retriedRequests = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.httpMethod, "PUT")
            XCTAssertEqual(request.request.url?.path, "/api/progress")
            retriedRequests += 1
            try request.respond(["success": true])
        }
        await library.flushProgress()
        await library.flushProgress()
        XCTAssertEqual(retriedRequests, 1)
        XCTAssertNil(library.error)
    }

    func testForegroundProgressRestorationFetchesLatestWithoutLoadingSubscriptions() async throws {
        let fixture = try await progressFixture()
        defer { fixture.cleanUp() }
        let phone = Episode(id: 1, guid: "tal", feed: "https://example.test/tal", title: "TAL", file: EpisodeFile(url: "https://example.test/tal.mp3"))
        let web = Episode(id: 2, guid: "web", feed: "https://example.test/web", title: "Web", file: EpisodeFile(url: "https://example.test/web.mp3"))
        var latest = PlaybackProgress(episode: phone, position: 3672)
        var reads = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.httpMethod, "GET")
            XCTAssertEqual(request.request.url?.path, "/api/progress")
            reads += 1
            try request.respond(latest)
        }
        let launch = await fixture.library.restoreProgress()
        XCTAssertEqual(launch?.episode.id, 1)
        latest = PlaybackProgress(episode: web, position: 1271)
        let foreground = await fixture.library.restoreProgress()
        XCTAssertEqual(foreground?.episode.id, 2)
        XCTAssertEqual(foreground?.position, 1271)
        XCTAssertEqual(reads, 2)
    }

    func testProgressRestorationFlushesPendingWritesBeforeReadingServer() async throws {
        let fixture = try await progressFixture()
        defer { fixture.cleanUp() }
        let episode = Episode(id: 42, guid: "offline", feed: "https://example.test/feed", title: "Offline", file: EpisodeFile(url: "https://example.test/offline.mp3"))
        GuestLibraryURLProtocol.handler = { request in request.fail(URLError(.notConnectedToInternet)) }
        fixture.library.saveProgress(.init(episode: episode, position: 123, completed: false))
        await fixture.library.flushProgress()
        XCTAssertNotNil(fixture.library.error)
        var methods: [String] = []
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/progress")
            let method = try XCTUnwrap(request.request.httpMethod)
            methods.append(method)
            if method == "PUT" { try request.respond(["success": true]) }
            else { try request.respond(PlaybackProgress(episode: episode, position: 123)) }
        }
        let latest = await fixture.library.restoreProgress()
        XCTAssertEqual(methods, ["PUT", "GET"])
        XCTAssertEqual(latest?.position, 123)
        XCTAssertNil(fixture.library.error)
    }

    func testUnsentProgressPreventsRestoringAnOlderServerPosition() async throws {
        let fixture = try await progressFixture()
        defer { fixture.cleanUp() }
        let episode = Episode(id: 42, guid: "offline", feed: "https://example.test/feed", title: "Offline", file: EpisodeFile(url: "https://example.test/offline.mp3"))
        var writes = 0
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.httpMethod, "PUT")
            writes += 1
            request.fail(URLError(.notConnectedToInternet))
        }
        fixture.library.saveProgress(.init(episode: episode, position: 123, completed: false))
        await fixture.library.flushProgress()
        let latest = await fixture.library.restoreProgress()
        XCTAssertNil(latest)
        XCTAssertGreaterThan(writes, 0)
        XCTAssertNotNil(fixture.library.error)
    }

    func testProgressRestorationCannotCrossAccountChanges() async throws {
        let fixture = try await progressFixture()
        defer { fixture.cleanUp() }
        fixture.session.prepareAccountChange = { _ in await fixture.library.resetProgressSync() }
        let started = expectation(description: "Old account progress lookup started")
        var pending: GuestLibraryRequest?
        GuestLibraryURLProtocol.handler = { request in
            if request.request.url?.path == "/api/auth/session" {
                try request.respond(["user": User(id: "other", email: "other@example.test")])
            } else {
                pending = request
                started.fulfill()
            }
        }
        let restore = Task { await fixture.library.restoreProgress() }
        await fulfillment(of: [started], timeout: 2)
        await fixture.session.restore()
        try XCTUnwrap(pending).respond(PlaybackProgress(
            episode: Episode(id: 42, guid: "private", feed: "https://example.test/private", title: "Private", file: EpisodeFile(url: "https://example.test/private.mp3"), isPrivate: true),
            position: 123
        ))
        let latest = await restore.value
        XCTAssertNil(latest)
        XCTAssertEqual(fixture.session.user?.id, "other")
        XCTAssertNil(fixture.library.error)
    }

    func testProgressFlushCannotReplayRetiredAccountDuringOrAfterSwitch() async throws {
        let fixture = try await guestFixture(podcasts: [])
        defer { fixture.cleanUp() }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let library = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults, progressDirectory: directory)
        GuestLibraryURLProtocol.handler = { request in
            try request.respond(["user": User(id: "first", email: "listener@example.test")])
        }
        await fixture.session.restore()
        GuestLibraryURLProtocol.handler = { request in
            request.fail(URLError(.notConnectedToInternet))
        }
        let episode = Episode(id: 42, guid: "private", feed: "https://example.test/feed", title: "Private", file: EpisodeFile(url: "https://example.test/audio.mp3"), isPrivate: true)
        library.saveProgress(.init(episode: episode, position: 123, completed: false))
        await library.flushProgress()
        fixture.session.prepareAccountChange = { _ in
            await library.flushProgress()
            await library.resetProgressSync()
        }
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/auth/session")
            try request.respond(["user": User(id: "second", email: "listener@example.test")])
        }
        await fixture.session.restore()
        await library.flushProgress()
        GuestLibraryURLProtocol.handler = { request in
            XCTAssertEqual(request.request.url?.path, "/api/auth/session")
            try request.respond(["user": User(id: "first", email: "listener@example.test")])
        }
        await fixture.session.restore()
        await library.flushProgress()
        XCTAssertEqual(fixture.session.user?.id, "first")
    }

    func testPrivateSourcesDoNotOfferPublicSharing() throws {
        var podcast = Podcast(feed: "https://example.test/feed?token=private", title: "Private", link: "https://example.test/show", isPrivate: true)
        let episode = Episode(guid: "private", feed: podcast.feed, title: "Private episode", link: "https://example.test/episode", file: EpisodeFile(url: "https://example.test/private.mp3"), isPrivate: true)
        XCTAssertNil(podcast.shareURL)
        XCTAssertNil(episode.shareURL)
        XCTAssertEqual(try JSONDecoder().decode(Episode.self, from: JSONEncoder().encode(episode)).isPrivate, true)
        podcast.isPrivate = false
        XCTAssertEqual(podcast.shareURL?.absoluteString, "https://example.test/show")
    }

    func testPrivatePodcastsCannotEnterTheGuestLibrary() async throws {
        let podcast = Podcast(id: 9124, feed: "https://example.test/private", title: "Private", isPrivate: true)
        let fixture = try await guestFixture(podcasts: [podcast])
        defer { fixture.cleanUp() }
        GuestLibraryURLProtocol.handler = { _ in XCTFail("Guest private subscription must not make a request") }
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        await fixture.library.toggleSubscription(podcast)
        XCTAssertTrue(fixture.library.podcasts.isEmpty)
        XCTAssertNotNil(fixture.library.error)
    }

    func testAuthenticatedRSSSearchAndImportUseBodiesAndPreservePrivacy() async throws {
        let feed = "https://example.test/\(UUID().uuidString)?token=a%2Bb"
        let podcast = Podcast(id: 9123, feed: feed, title: "Private show", isPrivate: true)
        let credentials = MemorySessionCredentials()
        credentials.write("private-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestLibraryURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://private.example.test")!, session: URLSession(configuration: configuration), keychain: credentials)
        defer { api.clearSession(); GuestLibraryURLProtocol.handler = nil }
        var paths: [String] = []
        GuestLibraryURLProtocol.handler = { incoming in
            let request = incoming.request
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertNil(request.url?.query)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "session=private-session")
            let path = try XCTUnwrap(request.url?.path)
            paths.append(path)
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    guard count > 0 else { break }
                    data.append(contentsOf: buffer.prefix(count))
                }
            }
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
            XCTAssertEqual(body[path == "/api/search" ? "term" : "url"], feed)
            if path == "/api/search" { try incoming.respond([podcast]) }
            else { try incoming.respond(podcast) }
        }
        let results = try await api.search(term: feed)
        XCTAssertEqual(results.first?.isPrivate, true)
        let detail = try await api.podcast(feed: feed)
        XCTAssertEqual(detail.isPrivate, true)
        XCTAssertEqual(paths, ["/api/search", "/api/feed"])
    }

    func testArtworkRetentionIncludesOwnedEpisodeAndFallbackArt() {
        let libraryCover = "https://example.test/library.jpg"
        let fallback = "https://example.test/cover.jpg"
        let episodeArt = "https://example.test/episode.jpg?token=private"
        let episode = Episode(guid: "queued", feed: "https://example.test/feed", title: "Queued", cover: fallback, episodeArt: episodeArt, file: EpisodeFile(url: "https://example.test/audio.mp3"))
        let snapshot = ArtworkRetentionSnapshot(
            accountID: "listener",
            podcasts: [Podcast(feed: "https://example.test/library", title: "Library", cover: libraryCover)],
            episodes: [episode, episode]
        )

        XCTAssertEqual(snapshot.urls, Set([libraryCover, fallback, episodeArt].compactMap(URL.init(string:))))
        XCTAssertEqual(snapshot.accountID, "listener")
    }

    func testArtworkRetentionKeepsSharedArtUntilItsLastOwnerLeaves() {
        let cover = "https://example.test/shared.jpg"
        let episode = Episode(guid: "download", feed: "https://example.test/feed", title: "Downloaded", cover: cover, file: EpisodeFile(url: "https://example.test/audio.mp3"))
        let subscribed = Podcast(feed: episode.feed, title: "Subscribed", cover: cover)
        let both = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [subscribed], episodes: [episode])
        let downloaded = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [episode])
        let removed = ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [])

        XCTAssertEqual(both, downloaded)
        XCTAssertFalse(downloaded.urls.isEmpty)
        XCTAssertTrue(removed.urls.isEmpty)
        XCTAssertNotEqual(downloaded, ArtworkRetentionSnapshot(accountID: "other", podcasts: [], episodes: [episode]))
        XCTAssertNotEqual(downloaded, ArtworkRetentionSnapshot(accountID: "listener", podcasts: [], episodes: [episode], isActive: false))
    }

    private func release(_ number: Int, podcast: Podcast) -> Episode {
        Episode(podcastId: podcast.id, guid: "episode-\(number)", feed: podcast.feed, podcastTitle: podcast.title, title: "Episode \(number)", published: Date(timeIntervalSince1970: Double(number) * 86400), file: EpisodeFile(url: "https://example.test/\(number).mp3"))
    }

    private func fixture(status: Int? = nil) throws -> SessionFixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("session.json")
        try JSONEncoder().encode(User(id: "listener", email: "listener@example.test")).write(to: url)
        let keychain = MemorySessionCredentials()
        keychain.write("test-session")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionURLProtocol.self]
        let api = APIClient(baseURL: URL(string: status.map { "https://status-\($0).example.test" } ?? "https://offline.example.test")!, session: URLSession(configuration: configuration), keychain: keychain)
        return SessionFixture(api: api, keychain: keychain, url: url)
    }

    private func progressFixture() async throws -> GuestLibraryFixture {
        let fixture = try await guestFixture(podcasts: [])
        GuestLibraryURLProtocol.handler = { request in
            try request.respond(["user": User(id: "listener", email: "listener@example.test")])
        }
        await fixture.session.restore()
        let library = LibraryStore(api: fixture.api, session: fixture.session, defaults: fixture.defaults, progressDirectory: fixture.url.appendingPathExtension("progress"))
        return GuestLibraryFixture(api: fixture.api, session: fixture.session, library: library, defaults: fixture.defaults, defaultsName: fixture.defaultsName, url: fixture.url)
    }

    private func guestFixture(podcasts: [Podcast], restoreSession: Bool = true) async throws -> GuestLibraryFixture {
        let defaultsName = "GuestLibrary-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: defaultsName)!
        defaults.set(try JSONEncoder().encode(podcasts), forKey: "guest.library.podcasts")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("json")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestLibraryURLProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://guest.example.test")!, session: URLSession(configuration: configuration), keychain: MemorySessionCredentials())
        GuestLibraryURLProtocol.handler = { request in
            try request.respond(["user": Optional<User>.none])
        }
        let session = SessionStore(api: api, storageURL: url)
        if restoreSession { await session.restore() }
        let library = LibraryStore(api: api, session: session, defaults: defaults)
        return GuestLibraryFixture(api: api, session: session, library: library, defaults: defaults, defaultsName: defaultsName, url: url)
    }
}

@MainActor
private struct GuestLibraryFixture {
    let api: APIClient
    let session: SessionStore
    let library: LibraryStore
    let defaults: UserDefaults
    let defaultsName: String
    let url: URL

    func cleanUp() {
        GuestLibraryURLProtocol.handler = nil
        defaults.removePersistentDomain(forName: defaultsName)
        try? FileManager.default.removeItem(at: url)
        try? FileManager.default.removeItem(at: url.appendingPathExtension("progress"))
    }
}

private final class GuestLibraryURLProtocol: URLProtocol, @unchecked Sendable {
    @MainActor static var handler: (@MainActor (GuestLibraryRequest) throws -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = GuestLibraryRequest(request: request) { [self] result in
            switch result {
            case .success(let (data, headers)):
                let response = HTTPURLResponse(url: self.request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            case .failure(let error):
                client?.urlProtocol(self, didFailWithError: error)
            }
        }
        Task { @MainActor in
            do { try GuestLibraryURLProtocol.handler?(request) }
            catch { request.fail(error) }
        }
    }

    override func stopLoading() {}
}

private struct GuestLibraryRequest: Sendable {
    let request: URLRequest
    let complete: @Sendable (Result<(Data, [String: String]), Error>) -> Void

    func respond<T: Encodable>(_ value: T, headers: [String: String] = [:]) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        complete(.success((try encoder.encode(value), headers.merging(["Content-Type": "application/json"]) { first, _ in first })))
    }

    func fail(_ error: Error) {
        complete(.failure(error))
    }
}

@MainActor
private struct SessionFixture {
    let api: APIClient
    let keychain: MemorySessionCredentials
    let url: URL

    func cleanUp() {
        keychain.delete()
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

private final class SessionURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        assert(!request.httpShouldHandleCookies)
        if let url = request.url, url.host == "status-200.example.test" {
            let payload: String
            switch url.path {
            case "/api/auth/session":
                payload = #"{"user":{"id":"listener","email":"listener@example.test","hasPasskey":false}}"#
            case "/api/subscriptions":
                payload = #"[{"id":9021,"feed":"https://example.test/feed","title":"Restored show","author":"Author","cover":"","explicit":false,"episodes":[{"id":9022,"guid":"restored","title":"Restored episode","explicit":false,"file":{"url":"https://example.test/audio.mp3"}}]}]"#
            case "/api/progress":
                payload = "null"
            default:
                client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
                return
            }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(payload.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if request.url?.host == "status-999.example.test", request.url?.path == "/api/auth/session" {
            NotificationCenter.default.post(name: Notification.Name("SessionTestRequestStarted"), object: nil)
            return
        }
        guard let url = request.url, url.host == "status-401.example.test" else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"message\":\"Expired\"}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
private final class MemorySessionCredentials: SessionCredentialStore {
    private var value: String?
    func read() -> String? { value }
    func write(_ value: String) { self.value = value }
    func delete() { value = nil }
}
