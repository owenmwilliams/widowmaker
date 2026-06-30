//
//  MediaPicker.swift
//  Nexus Moves
//
//  Native camera + photo-library capture for the agent flow. One component
//  handles both a photo and a room-walkthrough video, from either the camera or
//  the library, and hands back raw Data + a MIME type ready to upload.
//

import SwiftUI
import UIKit
import AVFoundation

struct MediaPicker: UIViewControllerRepresentable {
    enum Source: Equatable { case camera, library }

    let source: Source
    /// (data, mimeType, filename)
    let onPicked: (Data, String, String) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        let wantsCamera = source == .camera && UIImagePickerController.isSourceTypeAvailable(.camera)
        picker.sourceType = wantsCamera ? .camera : .photoLibrary
        picker.mediaTypes = ["public.image", "public.movie"]
        // Higher-quality capture/export → sharper frames for item detection.
        picker.videoExportPreset = AVAssetExportPresetHighestQuality
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
