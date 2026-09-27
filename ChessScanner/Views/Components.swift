import SwiftUI
@preconcurrency import UIKit
import PhotosUI

// MARK: - Color Extension

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
        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}

// MARK: - Notion Design System

enum NotionTheme {
    // Backgrounds
    static let background = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 25/255, green: 25/255, blue: 25/255, alpha: 1) :
            UIColor(red: 251/255, green: 251/255, blue: 250/255, alpha: 1)
    })

    static let surface = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 32/255, green: 32/255, blue: 32/255, alpha: 1) :
            UIColor(red: 247/255, green: 246/255, blue: 243/255, alpha: 1)
    })

    static let surfaceElevated = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 43/255, green: 43/255, blue: 43/255, alpha: 1) :
            UIColor(red: 239/255, green: 237/255, blue: 234/255, alpha: 1)
    })

    static let surfaceCard = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 47/255, green: 47/255, blue: 47/255, alpha: 1) :
            UIColor.white
    })

    // Accent
    static let accent = Color(hex: "2383E2")

    // Text
    static let textPrimary = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? .white :
            UIColor(red: 55/255, green: 53/255, blue: 47/255, alpha: 1)
    })

    static let textSecondary = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 155/255, green: 154/255, blue: 151/255, alpha: 1) :
            UIColor(red: 120/255, green: 119/255, blue: 116/255, alpha: 1)
    })

    static let textTertiary = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 90/255, green: 90/255, blue: 90/255, alpha: 1) :
            UIColor(red: 195/255, green: 194/255, blue: 191/255, alpha: 1)
    })

    // Borders & Dividers
    static let border = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(red: 55/255, green: 55/255, blue: 55/255, alpha: 1) :
            UIColor(red: 227/255, green: 226/255, blue: 222/255, alpha: 1)
    })

    static let divider = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ?
            UIColor(white: 1, alpha: 0.06) :
            UIColor(red: 227/255, green: 226/255, blue: 222/255, alpha: 0.6)
    })

    // Semantic
    static let error = Color(hex: "EB5757")
    static let warning = Color(hex: "F0A500")
}

// MARK: - Board Colors

struct BoardColors {
    static let lightSquare = Color(hex: "EBECD0")
    static let darkSquare = Color(hex: "739552")
    static let selectedSquare = Color(hex: "F6F669").opacity(0.65)
    static let legalMoveIndicator = Color.black.opacity(0.2)
    static let lastMoveHighlight = Color(hex: "F6F669").opacity(0.42)
    static let checkHighlight = Color(hex: "FF453A").opacity(0.6)
    static let coordLabel = Color.primary.opacity(0.5)
}

// MARK: - Glass Card Modifier

struct GlassCard: ViewModifier {
    var cornerRadius: CGFloat = 10
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(NotionTheme.surfaceCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .strokeBorder(NotionTheme.border, lineWidth: 1)
                    )
            )
    }
}

extension View {
    func glassCard(cornerRadius: CGFloat = 10, padding: CGFloat = 16) -> some View {
        modifier(GlassCard(cornerRadius: cornerRadius, padding: padding))
    }
}

// MARK: - Slide Up Appear Animation

struct SlideUpAppear: ViewModifier {
    let delay: Double
    @Binding var trigger: Bool

    func body(content: Content) -> some View {
        content
            .opacity(trigger ? 1 : 0)
            .offset(y: trigger ? 0 : 16)
            .animation(
                .spring(response: 0.5, dampingFraction: 0.85).delay(delay),
                value: trigger
            )
    }
}

extension View {
    func slideUpAppear(delay: Double, trigger: Binding<Bool>) -> some View {
        modifier(SlideUpAppear(delay: delay, trigger: trigger))
    }
}

// MARK: - Button Styles

struct NotionPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct NotionCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Piece View

struct PieceView: View {
    let piece: Piece
    var size: CGFloat = 36

    var body: some View {
        Text(piece.unicode)
            .font(.system(size: size))
            .shadow(color: piece.color == .white ? .black.opacity(0.5) : .white.opacity(0.2),
                    radius: 1.5, x: 0, y: 1)
    }
}

// MARK: - Captured Pieces Row

struct CapturedPiecesRow: View {
    let pieces: [PieceType: Int]
    let color: PieceColor
    let advantage: Int

    var body: some View {
        HStack(spacing: 1) {
            let orderedTypes: [PieceType] = [.queen, .rook, .bishop, .knight, .pawn]
            ForEach(orderedTypes, id: \.rawValue) { type in
                if let count = pieces[type], count > 0 {
                    ForEach(0..<count, id: \.self) { _ in
                        Text(Piece(type: type, color: color).unicode)
                            .font(.system(size: 14))
                    }
                }
            }
            if advantage > 0 {
                Text("+\(advantage)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(NotionTheme.textSecondary)
            }
            Spacer()
        }
        .frame(height: 20)
    }
}

// MARK: - Pulsing Dot

struct PulsingDot: View {
    @State private var isAnimating = false

    var body: some View {
        Circle()
            .fill(NotionTheme.accent)
            .frame(width: 8, height: 8)
            .shadow(color: NotionTheme.accent.opacity(0.5), radius: isAnimating ? 6 : 2)
            .scaleEffect(isAnimating ? 1.2 : 0.8)
            .opacity(isAnimating ? 1.0 : 0.5)
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isAnimating)
            .onAppear { isAnimating = true }
    }
}

// MARK: - Primary Action Button

struct PrimaryActionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2.weight(.semibold))
                Text(title)
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(NotionTheme.accent, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(NotionPrimaryButtonStyle())
    }
}

// MARK: - Secondary Action Button

struct SecondaryActionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(NotionTheme.accent)
                Text(title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(NotionTheme.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 80)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(NotionTheme.surfaceCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(NotionTheme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(NotionCardButtonStyle())
    }
}

// MARK: - Image Picker

struct ImagePicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss
    var sourceType: UIImagePickerController.SourceType = .photoLibrary

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = sourceType
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ImagePicker

        init(_ parent: ImagePicker) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.image = image
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

// MARK: - Photo Picker (PHPicker)

struct PhotoPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: PhotoPicker

        init(_ parent: PhotoPicker) {
            self.parent = parent
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            parent.dismiss()
            guard let provider = results.first?.itemProvider,
                  provider.canLoadObject(ofClass: UIImage.self) else { return }
            provider.loadObject(ofClass: UIImage.self) { [weak self] image, _ in
                let uiImage = image as? UIImage
                Task { @MainActor [weak self] in
                    self?.parent.image = uiImage
                }
            }
        }
    }
}
