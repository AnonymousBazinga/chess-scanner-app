import SwiftUI

/// Vertical evaluation bar shown beside the board, Chess.com / Lichess style.
struct EvalBarView: View {
    /// Top engine line, or nil before the first result.
    let line: EngineLine?
    var flipped = false

    /// White's share of the bar, using Lichess's win-probability curve.
    private var whiteShare: Double {
        guard let line else { return 0.5 }
        if let mate = line.mate { return mate > 0 ? 1 : 0 }
        let winning = 2 / (1 + exp(-0.00368208 * Double(line.score))) - 1
        return min(0.97, max(0.03, 0.5 + winning / 2))
    }

    private var label: String {
        guard let line else { return "" }
        if let mate = line.mate { return "M\(abs(mate))" }
        let pawns = abs(Double(line.score)) / 100
        return pawns >= 10 ? String(format: "%.0f", pawns) : String(format: "%.1f", pawns)
    }

    private var whiteAhead: Bool { whiteShare >= 0.5 }

    var body: some View {
        GeometryReader { geo in
            let whiteHeight = geo.size.height * whiteShare
            ZStack(alignment: flipped ? .top : .bottom) {
                Theme.evalBlack
                Theme.evalWhite
                    .frame(height: whiteHeight)
                    .frame(maxWidth: .infinity)
            }
            .overlay(alignment: labelAlignment) {
                Text(label)
                    .font(.system(size: 10, weight: .heavy, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(whiteAhead ? Theme.evalBlack : Theme.evalWhite)
                    .padding(.vertical, 5)
                    .contentTransition(.numericText())
            }
            .overlay {
                Rectangle().fill(Theme.textTertiary.opacity(0.5)).frame(height: 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .animation(Motion.smooth, value: whiteShare)
        .animation(Motion.smooth, value: label)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("eval.bar")
        .accessibilityLabel("Evaluation")
        .accessibilityValue(line?.scoreText ?? "pending")
    }

    /// The score sits at the end of the side that is ahead.
    private var labelAlignment: Alignment {
        (whiteAhead != flipped) ? .bottom : .top
    }
}

#Preview {
    HStack {
        EvalBarView(line: EngineLine(id: 1, score: 85, mate: nil, depth: 20, pv: [], pvSAN: [], nodes: 0))
        EvalBarView(line: EngineLine(id: 1, score: -420, mate: nil, depth: 20, pv: [], pvSAN: [], nodes: 0))
        EvalBarView(line: EngineLine(id: 1, score: 0, mate: 3, depth: 20, pv: [], pvSAN: [], nodes: 0))
    }
    .frame(width: 80, height: 320)
    .padding()
    .background(Theme.background)
}
