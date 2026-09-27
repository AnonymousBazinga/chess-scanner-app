import SwiftUI

/// Top engine lines, Chess.com style: an evaluation pill followed by the numbered line.
struct EngineLinesView: View {
    let lines: [EngineLine]
    let isAnalyzing: Bool
    let depth: Int
    var errorMessage: String?
    var engineOn: Binding<Bool>
    var onLineTap: ((EngineLine) -> Void)?

    private let rowCount = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

            Rectangle().fill(Theme.stroke).frame(height: 1)

            VStack(spacing: 0) {
                ForEach(0..<rowCount, id: \.self) { index in
                    row(at: index)
                    if index < rowCount - 1 {
                        Rectangle().fill(Theme.stroke).frame(height: 1).padding(.leading, 12)
                    }
                }
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.stroke))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "cpu")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(engineOn.wrappedValue ? Theme.accent : Theme.textTertiary)
            Text("Stockfish 17")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)

            if engineOn.wrappedValue && depth > 0 {
                Text("depth \(depth)")
                    .font(.caption.weight(.medium).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .contentTransition(.numericText())
                    .accessibilityIdentifier("engine.depth")
                    .accessibilityValue("\(depth)")
            }
            if engineOn.wrappedValue && isAnalyzing {
                ProgressView().controlSize(.mini).tint(Theme.textSecondary)
            }

            Spacer()

            Toggle("Engine", isOn: engineOn)
                .labelsHidden()
                .tint(Theme.accent)
                .scaleEffect(0.8)
                .frame(height: 28)
                .accessibilityIdentifier("engine.toggle")
        }
        .animation(Motion.snappy, value: depth)
    }

    @ViewBuilder
    private func row(at index: Int) -> some View {
        if let message = errorMessage, index == 0 {
            placeholderRow(text: message, icon: "exclamationmark.triangle.fill", color: Theme.warning)
        } else if !engineOn.wrappedValue {
            placeholderRow(text: index == 0 ? "Engine is off" : "", icon: nil, color: Theme.textTertiary)
        } else if index < lines.count {
            EngineLineRow(line: lines[index], isBest: index == 0)
                .contentShape(Rectangle())
                .onTapGesture { onLineTap?(lines[index]) }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("engine.line")
                .accessibilityAddTraits(.isButton)
                .transition(.opacity)
        } else {
            SkeletonRow(delay: Double(index) * 0.15)
        }
    }

    private func placeholderRow(text: String, icon: String?, color: Color) -> some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon) }
            Text(text).lineLimit(2)
            Spacer()
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(color)
        .padding(.horizontal, 12)
        .frame(height: 40)
    }
}

struct EngineLineRow: View {
    let line: EngineLine
    let isBest: Bool

    private var whiteBetter: Bool {
        if let mate = line.mate { return mate > 0 }
        return line.score >= 0
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(line.scoreText)
                .font(.system(size: 13, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(whiteBetter ? Theme.evalBlack : Theme.evalWhite)
                .frame(minWidth: 50)
                .padding(.vertical, 5)
                .background(whiteBetter ? Theme.evalWhite : Theme.evalBlack,
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Color.white.opacity(whiteBetter ? 0 : 0.12)))
                .contentTransition(.numericText())

            Text(line.numberedLine)
                .font(.system(size: 14, weight: isBest ? .semibold : .regular))
                .foregroundStyle(isBest ? Theme.textPrimary : Theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .animation(Motion.snappy, value: line.scoreText)
    }
}

/// Pulsing placeholder while the engine warms up.
struct SkeletonRow: View {
    var delay: Double = 0
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 6).frame(width: 50, height: 24)
            RoundedRectangle(cornerRadius: 4).frame(height: 12)
            Spacer(minLength: 40)
        }
        .foregroundStyle(Theme.surfaceRaised)
        .opacity(pulse ? 1 : 0.45)
        .padding(.horizontal, 12)
        .frame(height: 40)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever().delay(delay)) { pulse = true }
        }
    }
}

#Preview {
    EngineLinesView(
        lines: [
            EngineLine(id: 1, score: 35, mate: nil, depth: 22, pv: [], pvSAN: ["e4", "e5", "Nf3", "Nc6", "Bb5"], nodes: 0),
            EngineLine(id: 2, score: 28, mate: nil, depth: 22, pv: [], pvSAN: ["d4", "d5", "c4", "e6"], nodes: 0),
            EngineLine(id: 3, score: -12, mate: nil, depth: 22, pv: [], pvSAN: ["Nf3", "d5", "g3"], nodes: 0),
        ],
        isAnalyzing: true, depth: 22, engineOn: .constant(true)
    )
    .padding()
    .background(Theme.background)
}
