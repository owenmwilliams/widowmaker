//
//  MediaPicker.swift
//  Nexus Moves
//
//  Native camera + library capture for the agent flow. The camera and the
//  video-library paths use UIImagePickerController (its 720p video export
//  keeps walkthroughs small enough to upload); the photo-library path uses
//  PHPicker so up to five images can be selected at once and attached as
//  separate attachments that scan together as one job.
//

import SwiftUI
import UIKit
import AVFoundation
import PhotosUI

/// One picked media item ready to attach to the composer.
struct PickedMedia: Identifiable {
    let id = UUID()
    let data: Data
    let mimeType: String
    let filename: String
    var isVideo: Bool { mimeType.hasPrefix("video") }
}

struct MediaPicker: UIViewControllerRepresentable {
    enum Source: Equatable { case camera, videoLibrary, photoLibrary }

    let source: Source
    /// (data, mimeType, filename)
    let onPicked: (Data, String, String) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        let wantsCamera = source == .camera && UIImagePickerController.isSourceTypeAvailable(.camera)
        picker.sourceType = wantsCamera ? .camera : .photoLibrary
        picker.mediaTypes = source == .videoLibrary ? ["public.movie"] : ["public.image", "public.movie"]
        // 720p keeps walkthroughs sharp enough for item detection AND small enough
        // to clear the ~32MB request cap on the upload endpoint. HighestQuality
        // produced multi-hundred-MB files that failed to upload (413).
        picker.videoExportPreset = AVAssetExportPreset1280x720
        picker.videoQuality = .typeHigh
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: MediaPicker
        init(_ parent: MediaPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let videoURL = info[.mediaURL] as? URL {
                if let data = try? Data(contentsOf: videoURL) {
                    parent.onPicked(data, Self.mimeType(for: videoURL), videoURL.lastPathComponent)
                } else {
                    parent.onCancel()
                }
            } else if let image = (info[.editedImage] as? UIImage) ?? (info[.originalImage] as? UIImage),
                      let data = image.jpegData(compressionQuality: 0.8) {
                parent.onPicked(data, "image/jpeg", "photo.jpg")
            } else {
                parent.onCancel()
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }

        static func mimeType(for url: URL) -> String {
            switch url.pathExtension.lowercased() {
            case "mp4":  return "video/mp4"
            case "m4v":  return "video/x-m4v"
            case "mov":  return "video/quicktime"
            default:     return "video/quicktime"
            }
        }
    }
}

/// Multi-select photo picker: up to `selectionLimit` library images, delivered
/// in selection order as JPEGs ready to upload.
struct PhotoLibraryPicker: UIViewControllerRepresentable {
    let selectionLimit: Int
    let onPicked: ([PickedMedia]) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = selectionLimit
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: PhotoLibraryPicker
        init(_ parent: PhotoLibraryPicker) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else {
                parent.onCancel()
                return
            }
            // Load every selection concurrently, then deliver in the order the
            // user picked them; items that fail to load are simply skipped.
            let group = DispatchGroup()
            var slots = [Data?](repeating: nil, count: results.count)
            let lock = NSLock()
            for (index, result) in results.enumerated() {
                group.enter()
                result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
                    if let image = object as? UIImage,
                       let data = image.jpegData(compressionQuality: 0.8) {
                        lock.lock()
                        slots[index] = data
                        lock.unlock()
                    }
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                let picked = slots.compactMap { $0 }.enumerated().map { index, data in
                    PickedMedia(data: data, mimeType: "image/jpeg", filename: "photo\(index + 1).jpg")
                }
                if picked.isEmpty {
                    self.parent.onCancel()
                } else {
                    self.parent.onPicked(picked)
                }
            }
        }
    }
}
