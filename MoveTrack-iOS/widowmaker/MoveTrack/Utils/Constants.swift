//
//  Constants.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation

struct Constants {
    // MARK: - API Configuration
    #if DEBUG
    static let apiBaseURL = "http://127.0.0.1:3050"
    #else
    static let apiBaseURL = "https://movetrack-api-7hwn7ggbiq-uc.a.run.app"
    #endif

    // MARK: - URL Scheme
    static let urlScheme = "movetrack"

    // MARK: - Keychain Keys
    static let keychainServiceName = "com.movetrack.MoveTrack"
    static let sessionTokenKey = "sessionToken"
    static let userDataKey = "userData"

    // MARK: - UserDefaults Keys
    static let lastSyncKey = "lastSyncTimestamp"
    static let offlineModeKey = "offlineMode"

    // MARK: - API Endpoints
    struct Endpoints {
        static let requestMagicLink = "/auth/request-magic-link"
        static let verifyMagicLink = "/auth/verify-magic-link"
        static let logout = "/auth/logout"
        static let me = "/auth/me"

        static let locations = "/locations"
        static let collections = "/collections"
        static let containers = "/containers"
        static let items = "/items"
        static let lists = "/lists"

        static let uploadFile = "/file/upload"
        static let deleteFile = "/file/delete"

        static let analyzeItem = "/vision/analyze-item"
    }

    // MARK: - Image Configuration
    static let maxImageWidth: CGFloat = 800
    static let maxImageHeight: CGFloat = 800
    static let imageCompressionQuality: CGFloat = 0.8

    // MARK: - UI Constants
    static let defaultPadding: CGFloat = 16
    static let cornerRadius: CGFloat = 12
    static let thumbnailSize: CGFloat = 60
}
