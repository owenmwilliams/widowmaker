//
//  LocationsListView.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import SwiftUI

struct LocationsListView: View {
    @StateObject private var viewModel: LocationsViewModel
    @EnvironmentObject var authViewModel: AuthViewModel

    let userId: UUID

    init(userId: UUID) {
        self.userId = userId
        _viewModel = StateObject(wrappedValue: LocationsViewModel(userId: userId))
    }

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.locations.isEmpty {
                    ProgressView("Loading locations...")
                } else if viewModel.locations.isEmpty {
                    EmptyStateView(
                        icon: "house.fill",
                        title: "No Locations Yet",
                        message: "Add a location to start organizing your inventory"
                    )
                } else {
                    locationsList
                }
            }
            .navigationTitle("Locations")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Menu {
                        Button(role: .destructive, action: logout) {
                            Label("Logout", systemImage: "arrow.right.square")
                        }
                    } label: {
                        Image(systemName: "person.circle")
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { /* TODO: Add location */ }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .task {
                await viewModel.loadLocations()
            }
            .refreshable {
                await viewModel.refresh()
            }
        }
    }

    // MARK: - Locations List
    private var locationsList: some View {
        List(viewModel.locations) { location in
            NavigationLink(
                destination: CollectionsListView(
                    userId: userId,
                    locationId: location.id,
                    locationName: location.name
                )
            ) {
                LocationRow(location: location)
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Actions
    private func logout() {
        Task {
            await authViewModel.logout()
        }
    }
}

// MARK: - Location Row
struct LocationRow: View {
    let location: Location

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: locationIcon)
                    .foregroundColor(.blue)
                    .frame(width: 24)

                Text(location.name)
                    .font(.headline)

                Spacer()

                if let itemCount = location.itemCount {
                    Text("\(itemCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.blue)
                        .cornerRadius(12)
                }
            }

            if !location.fullAddress.isEmpty {
                Text(location.fullAddress)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(location.countSummary)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var locationIcon: String {
        switch location.locationType {
        case "primary_residence", "residence":
            return "house.fill"
        case "storage_unit":
            return "building.2.fill"
        case "warehouse":
            return "building.fill"
        case "truck":
            return "truck.box.fill"
        default:
            return "mappin.circle.fill"
        }
    }
}

// MARK: - Empty State View
struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text(title)
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
    }
}

#Preview {
    LocationsListView(userId: UUID())
        .environmentObject(AuthViewModel())
}
