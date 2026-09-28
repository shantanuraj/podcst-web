import SwiftUI

struct SearchView: View {
    @Environment(APIClient.self) private var api
    @AppStorage(DiscoveryRegion.key) private var region = DiscoveryRegion.detected.rawValue
    @AppStorage("recentSearches") private var recentStorage = ""
    @State private var query = ""
    @State private var results: [Podcast] = []
    @State private var isSearching = false

    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var recent: [String] { recentStorage.split(separator: "\n").map(String.init) }
    private var feedURL: URL? {
        URL(string: term).flatMap { ["http", "https"].contains($0.scheme?.lowercased()) ? $0 : nil }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if term.isEmpty || feedURL != nil {
                    FeedHint(isFeed: feedURL != nil)
                        .padding(.bottom, 22)
                }
                if !term.isEmpty {
                    SectionHeader(feedURL == nil ? "Podcasts" : "Feed") {
                        if isSearching {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("\(results.count) results").eyebrow()
                        }
                    }
                    ForEach(results, id: \.identity) { podcast in
                        PodcastRow(podcast: podcast)
                            .simultaneousGesture(TapGesture().onEnded { remember(term) })
                    }
                } else if !recent.isEmpty {
                    SectionHeader("Recent") {
                        Button("Clear") { recentStorage = "" }
                            .font(.sans(.footnote).weight(.medium))
                            .foregroundStyle(PodcstPalette.accent)
                    }
                    FlowLayout(spacing: 8) {
                        ForEach(recent, id: \.self) { item in
                            Button(item) { query = item }
                                .font(.sans(.footnote))
                                .foregroundStyle(PodcstPalette.secondary)
                                .padding(.horizontal, 13)
                                .padding(.vertical, 7)
                                .background(PodcstPalette.surface, in: Capsule())
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .podcstPage()
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Podcasts or RSS link")
        .textInputAutocapitalization(.never)
        .onSubmit(of: .search) { remember(term) }
        .task(id: query) {
            do {
                try await Task.sleep(for: .milliseconds(300))
            } catch {
                return
            }
            await search(term)
        }
    }

    private func search(_ term: String) async {
        guard !term.isEmpty else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            if feedURL != nil {
                results = [try await api.podcast(feed: term)]
            } else {
                results = try await api.search(term: term, locale: region)
            }
        } catch {
            guard !Task.isCancelled else { return }
            results = []
        }
    }

    private func remember(_ term: String) {
        guard !term.isEmpty, feedURL == nil else { return }
        recentStorage = ([term] + recent.filter { $0.caseInsensitiveCompare(term) != .orderedSame })
            .prefix(8)
            .joined(separator: "\n")
    }
}

private struct FeedHint: View {
    let isFeed: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isFeed ? "dot.radiowaves.up.forward" : "plus")
                .font(.sans(.body).weight(.medium))
                .foregroundStyle(PodcstPalette.accent)
            Text(isFeed ? "Open the feed below to subscribe, including private feeds." : "Paste an RSS link to add any feed, including private ones.")
                .font(.sans(.footnote))
                .foregroundStyle(PodcstPalette.secondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(PodcstPalette.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
        var y: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let proposed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if proposed > width, !rows[rows.count - 1].indices.isEmpty {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += (rows[rows.count - 1].indices.count > 1 ? spacing : 0) + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
