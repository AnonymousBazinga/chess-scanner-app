import SwiftUI

struct HistoryView: View {
    @ObservedObject var store: ScanHistoryStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmClear = false

    var onSelect: (String) -> Void

    var body: some View {
        Group {
            if store.items.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Done") { dismiss() }
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.textPrimary)
            }
            if !store.items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") { confirmClear = true }
                        .foregroundStyle(Theme.danger)
                }
            }
        }
        .confirmationDialog("Delete all saved positions?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Delete All", role: .destructive) {
                withAnimation(Motion.smooth) { store.clearAll() }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "square.grid.3x3.square")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Theme.textTertiary)
            Text("No positions yet")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)
            Text("Positions you analyze are saved here.")
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        List {
            ForEach(store.items) { item in
                Button {
                    Haptics.tap()
                    onSelect(item.fen)
                    dismiss()
                } label: {
                    row(item)
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .accessibilityIdentifier("history.row")
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            }
            .onDelete { offsets in
                for index in offsets { store.removeItem(store.items[index]) }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func row(_ item: ScanHistoryItem) -> some View {
        let position = Position(fen: item.fen)
        return HStack(spacing: 14) {
            BoardView(position: position, showCoordinates: false, interactive: false)
                .frame(width: 72, height: 72)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(item.label ?? "Scanned position")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                HStack(spacing: 6) {
                    Circle()
                        .fill(position.sideToMove == .white ? Theme.evalWhite : Theme.evalBlack)
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.3)))
                        .frame(width: 9, height: 9)
                    Text("\(position.sideToMove.name) to move")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(item.timestamp, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(Theme.textTertiary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .contentShape(Rectangle())
    }
}
