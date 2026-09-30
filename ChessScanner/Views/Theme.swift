import SwiftUI
import UIKit

// MARK: - Palette

/// App-wide design tokens. The app is dark-only, like most chess analysis boards.
enum Theme {
    static let background = Color(hex: "161512")
    static let surface = Color(hex: "22211E")
    static let surfaceRaised = Color(hex: "2C2A27")
    static let surfacePressed = Color(hex: "3A3834")
    static let stroke = Color.white.opacity(0.07)

    static let textPrimary = Color(hex: "F3F2EF")
    static let textSecondary = Color(hex: "A8A5A0")
    static let textTertiary = Color(hex: "6E6B66")

    static let accent = Color(hex: "81B64C")
    static let accentDeep = Color(hex: "5D8F2E")
    static let warning = Color(hex: "F2B544")
    static let danger = Color(hex: "E5534B")

    static let evalWhite = Color(hex: "F1F0EC")
    static let evalBlack = Color(hex: "3C3A36")
}

enum BoardColors {
    static let light = Color(hex: "EBECD0")
    static let dark = Color(hex: "739552")
    static let highlight = Color(hex: "F5F682")
    static let selected = Color(hex: "F5F682")
    static let hint = Color.black.opacity(0.16)
    static let arrow = Color(hex: "F2A93B")
    static let check = Color(hex: "FF3B30")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6: (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255,
                  blue: Double(b) / 255, opacity: Double(a) / 255)
    }
}

// MARK: - Motion & Haptics

enum Motion {
    static let snappy = Animation.spring(response: 0.28, dampingFraction: 0.86)
    static let smooth = Animation.spring(response: 0.45, dampingFraction: 0.9)
}

@MainActor
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func move() { UIImpactFeedbackGenerator(style: .medium).impactOccurred(intensity: 0.7) }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}

// MARK: - Components

/// Rounded card container used across screens.
struct Card<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.stroke))
    }
}

/// Subtle press feedback: slight scale and dim.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Full-width primary call to action.
struct PrimaryButton: View {
    let title: String
    var icon: String?
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).font(.body.weight(.semibold)) }
                Text(title).font(.body.weight(.semibold))
            }
            .foregroundStyle(enabled ? Color.white : Theme.textTertiary)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(enabled ? Theme.accent : Theme.surfaceRaised)
                    .shadow(color: enabled ? Theme.accentDeep.opacity(0.9) : .clear, radius: 0, x: 0, y: 3)
            )
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .disabled(!enabled)
    }
}

/// Square icon button used in toolbars.
struct IconButton: View {
    let icon: String
    var label: String
    var size: CGFloat = 44
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(prominent ? Color.white : Theme.textPrimary)
                .frame(width: size, height: size)
                .background(prominent ? Theme.accent : Theme.surfaceRaised,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

/// A small pill label, e.g. warnings.
struct Pill: View {
    let text: String
    var icon: String?
    var color: Color = Theme.warning

    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon) }
            Text(text)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

// MARK: - Piece

struct PieceView: View {
    let piece: Piece

    var body: some View {
        Image(piece.assetName)
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
    }
}

extension Piece {
    /// Asset catalog name, e.g. `piece-wK`.
    var assetName: String {
        "piece-\(color == .white ? "w" : "b")\(type.symbol.isEmpty ? "P" : type.symbol)"
    }
}
