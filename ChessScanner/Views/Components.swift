import SwiftUI
import PhotosUI

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
            // PHPicker calls back on a background queue; an unannotated closure here
            // would inherit main-actor isolation and trap at runtime under Swift 6.
            let coordinator = UncheckedSendable(value: self)
            provider.loadObject(ofClass: UIImage.self) { @Sendable object, _ in
                let uiImage = object as? UIImage
                Task { @MainActor in
                    coordinator.value.parent.image = uiImage
                }
            }
        }
    }
}

/// Carries a reference across an isolation boundary we know is safe.
struct UncheckedSendable<Value>: @unchecked Sendable {
    let value: Value
}
