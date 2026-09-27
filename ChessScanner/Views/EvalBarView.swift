import SwiftUI

struct EvalBarView: View {
    let score: Double
    let isAnalyzing: Bool
    var orientation: Orientation = .vertical
    var flipped: Bool = false

    enum Orientation {
        case vertical, horizontal
    }

    private var whitePercentage: Double {
        let sigmoid = 1.0 / (1.0 + exp(-score * 0.4))
        return max(0.03, min(0.97, sigmoid))
    }

    private var scoreText: String {
        if abs(score) >= 9.9 {
            return score > 0 ? "M" : "-M"
        }
        return String(format: "%.1f", abs(score))
    }

    var body: some View {
        GeometryReader { geo in
            if orientation == .vertical {
                verticalBar(size: geo.size)
            } else {
                horizontalBar(size: geo.size)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .strokeBorder(NotionTheme.border, lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.6), value: score)
    }

    @ViewBuilder
    private func verticalBar(size: CGSize) -> some View {
        let whitePortion = flipped ? (1 - whitePercentage) : whitePercentage

        ZStack {
            VStack(spacing: 0) {
                // Black portion (top)
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color(white: 0.12), Color(white: 0.18)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: size.height * (1 - whitePortion))

                // White portion (bottom)
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color(white: 0.88), Color(white: 0.95)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: size.height * whitePortion)
            }

            // Score label
            VStack {
                if whitePortion < 0.5 {
                    Text(scoreText)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.top, 4)
                    Spacer()
                } else {
                    Spacer()
                    Text(scoreText)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(.black.opacity(0.6))
                        .padding(.bottom, 4)
                }
            }
        }
    }

    @ViewBuilder
    private func horizontalBar(size: CGSize) -> some View {
        ZStack {
            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color(white: 0.92))
                    .frame(width: size.width * whitePercentage)

                Rectangle()
                    .fill(Color(white: 0.15))
                    .frame(width: size.width * (1 - whitePercentage))
            }

            Text(scoreText)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(whitePercentage > 0.5 ? .black.opacity(0.6) : .white.opacity(0.8))
        }
    }
}

#Preview {
    HStack {
        EvalBarView(score: 1.5, isAnalyzing: true, orientation: .vertical)
            .frame(width: 28, height: 300)
        EvalBarView(score: -2.0, isAnalyzing: false, orientation: .vertical)
            .frame(width: 28, height: 300)
        EvalBarView(score: 0.0, isAnalyzing: true, orientation: .vertical)
            .frame(width: 28, height: 300)
    }
    .padding()
    .background(NotionTheme.background)
}
