import SwiftUI

struct EngineLinesView: View {
    let lines: [EngineLine]
    let isAnalyzing: Bool
    let depth: Int
    let nodes: Int
    var nps: Int = 0
    var onLineTap: ((EngineLine) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Engine header
            HStack(spacing: 8) {
                if isAnalyzing {
                    PulsingDot()
                }
                Text("Stockfish 17")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(NotionTheme.textPrimary)

                Spacer()

                HStack(spacing: 10) {
                    if depth > 0 {
                        Text("d\(depth)")
                            .accessibilityIdentifier("engine.depth")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(NotionTheme.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(NotionTheme.surface, in: Capsule())
                    }

                    if nps > 0 {
                        Text(formatNPS(nps))
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(NotionTheme.textTertiary)
                    } else if nodes > 0 {
                        Text(formatNodes(nodes))
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(NotionTheme.textTertiary)
                    }
                }
            }
            .padding(.horizontal, 4)

            if lines.isEmpty && isAnalyzing {
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(NotionTheme.accent)
                        .scaleEffect(0.8)
                    Text("Analyzing...")
                        .font(.subheadline)
                        .foregroundStyle(NotionTheme.textSecondary)
                    Spacer()
                }
                .padding(.vertical, 12)
            } else if lines.isEmpty {
                Text("No analysis available")
                    .font(.subheadline)
                    .foregroundStyle(NotionTheme.textSecondary)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 4) {
                    ForEach(lines) { line in
                        EngineLineRow(line: line, isBest: line.id == 1)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("engine.line")
                            .contentShape(Rectangle())
                            .onTapGesture {
                                onLineTap?(line)
                            }
                    }
                }
            }
        }
        .glassCard(cornerRadius: 10, padding: 12)
    }

    private func formatNodes(_ n: Int) -> String {
        if n >= 1_000_000 {
            return String(format: "%.1fM nodes", Double(n) / 1_000_000)
        } else if n >= 1_000 {
            return String(format: "%.0fK nodes", Double(n) / 1_000)
        }
        return "\(n) nodes"
    }

    private func formatNPS(_ n: Int) -> String {
        if n >= 1_000_000 {
            return String(format: "%.1fM nps", Double(n) / 1_000_000)
        } else if n >= 1_000 {
            return String(format: "%.0fK nps", Double(n) / 1_000)
        }
        return "\(n) nps"
    }
}

// MARK: - Engine Line Row

struct EngineLineRow: View {
    let line: EngineLine
    let isBest: Bool

    var body: some View {
        HStack(spacing: 10) {
            // Score badge
            Text(line.scoreText)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(scoreColor)
                .frame(width: 48, alignment: .center)
                .padding(.vertical, 6)
                .padding(.horizontal, 6)
                .background(scoreBackground, in: RoundedRectangle(cornerRadius: 7))

            // Moves
            Text(line.pvString)
                .font(.system(size: 13, weight: isBest ? .medium : .regular, design: .monospaced))
                .foregroundStyle(isBest ? NotionTheme.textPrimary : NotionTheme.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer()
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .background(
            isBest ? NotionTheme.accent.opacity(0.06) : Color.clear,
            in: RoundedRectangle(cornerRadius: 8)
        )
    }

    private var scoreColor: Color {
        if line.score > 100 {
            return Color(white: 0.1)
        } else if line.score < -100 {
            return NotionTheme.textPrimary
        }
        return NotionTheme.textPrimary
    }

    private var scoreBackground: Color {
        if line.score > 100 {
            return Color(white: 0.85)
        } else if line.score < -100 {
            return Color(white: 0.18)
        }
        return NotionTheme.surface
    }
}

#Preview {
    EngineLinesView(
        lines: [
            EngineLine(id: 1, score: 55, depth: 18, pv: ["e2e4"],
                       pvString: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4", nodes: 1250000),
            EngineLine(id: 2, score: 30, depth: 18, pv: ["d2d4"],
                       pvString: "d4 d5 c4 e6 Nc3 Nf6 Bg5", nodes: 1250000),
            EngineLine(id: 3, score: 20, depth: 18, pv: ["g1f3"],
                       pvString: "Nf3 d5 g3 Nf6 Bg2 c6 O-O", nodes: 1250000),
        ],
        isAnalyzing: true,
        depth: 18,
        nodes: 1250000
    )
    .padding()
    .background(NotionTheme.background)
}
