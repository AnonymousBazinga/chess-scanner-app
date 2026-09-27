import SwiftUI

struct HistoryView: View {
    @ObservedObject var store: ScanHistoryStore
    @Environment(\.dismiss) private var dismiss

    var onSelect: (String) -> Void

    var body: some View {
        Group {
            if store.items.isEmpty {
                emptyState
            } else {
                listContent
            }
        }
        .background(NotionTheme.background)
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close") {
                    dismiss()
                }
                .foregroundStyle(NotionTheme.textPrimary)
            }

            if !store.items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear All", role: .destructive) {
                        store.clearAll()
                    }
                    .foregroundStyle(NotionTheme.error)
                    .font(.subheadline)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "clock")
                .font(.system(size: 40))
                .foregroundStyle(NotionTheme.textTertiary)
            Text("No scans yet")
                .font(.headline)
                .foregroundStyle(NotionTheme.textSecondary)
            Text("Scanned positions will appear here")
                .font(.subheadline)
                .foregroundStyle(NotionTheme.textTertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var listContent: some View {
        List {
            ForEach(store.items) { item in
                Button {
                    onSelect(item.fen)
                    dismiss()
                } label: {
                    historyRow(item)
                }
                .accessibilityIdentifier("history.row")
                .listRowBackground(NotionTheme.background)
                .listRowSeparatorTint(NotionTheme.divider)
            }
            .onDelete { offsets in
                for index in offsets {
                    store.removeItem(store.items[index])
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func historyRow(_ item: ScanHistoryItem) -> some View {
        HStack(spacing: 14) {
            BoardView(
                position: Position(fen: item.fen),
                flipped: false,
                interactive: false
            )
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                if let label = item.label {
                    Text(label)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(NotionTheme.textPrimary)
                }
                Text(item.fen.components(separatedBy: " ").first ?? item.fen)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(NotionTheme.textSecondary)
                    .lineLimit(1)
                Text(item.timestamp, style: .relative)
                    .font(.caption)
                    .foregroundStyle(NotionTheme.textTertiary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(NotionTheme.textTertiary)
        }
        .padding(.vertical, 4)
    }
}
