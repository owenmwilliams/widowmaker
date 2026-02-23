//
//  AddItemView.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import SwiftUI

struct AddItemView: View {
    @Environment(\.dismiss) var dismiss
    @ObservedObject var viewModel: ItemsViewModel

    @State private var name = ""
    @State private var description = ""
    @State private var quantity = "1"
    @State private var estimatedValue = ""
    @State private var fragile = false

    var body: some View {
        NavigationView {
            Form {
                Section("Item Information") {
                    TextField("Name", text: $name)
                        .autocapitalization(.words)

                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Quantity and Value") {
                    TextField("Quantity", text: $quantity)
                        .keyboardType(.numberPad)

                    TextField("Estimated Value ($)", text: $estimatedValue)
                        .keyboardType(.decimalPad)
                }

                Section {
                    Toggle("Fragile", isOn: $fragile)
                }

                Section {
                    Button("Add Photo") {
                        // TODO: Camera integration
                    }
                    .foregroundColor(.blue)
                }
            }
            .navigationTitle("Add Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveItem()
                    }
                    .disabled(name.isEmpty || viewModel.isLoading)
                }
            }
        }
    }

    // MARK: - Actions
    private func saveItem() {
        Task {
            let qty = Int(quantity) ?? 1
            let value = Double(estimatedValue)

            let success = await viewModel.createItem(
                name: name,
                description: description.isEmpty ? nil : description,
                quantity: qty > 1 ? qty : nil,
                estimatedValue: value,
                fragile: fragile
            )

            if success {
                dismiss()
            }
        }
    }
}

#Preview {
    AddItemView(viewModel: ItemsViewModel(userId: UUID(), collectionId: 1))
}
