//
//  APIClient.swift
//  MoveTrack
//
//  Created on 2025-12-26.
//

import Foundation

enum APIError: Error {
    case invalidURL
    case noData
    case decodingError(Error)
    case serverError(String)
    case unauthorized
    case networkError(Error)

    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noData:
            return "No data received from server"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .serverError(let message):
            return message
        case .unauthorized:
            return "Unauthorized - Please log in again"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let baseURL: String

    private init() {
        self.baseURL = Constants.apiBaseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
    }

    // MARK: - Generic Request Method
    func request<T: Decodable>(
        endpoint: String,
        method: String = "GET",
        body: Encodable? = nil,
        queryItems: [URLQueryItem]? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        guard var urlComponents = URLComponents(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }

        if let queryItems = queryItems {
            urlComponents.queryItems = queryItems
        }

        guard let url = urlComponents.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add authorization token if required
        if requiresAuth {
            if let token = KeychainService.shared.load(forKey: Constants.sessionTokenKey) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }

        // Add body if provided
        if let body = body {
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            request.httpBody = try encoder.encode(body)
        }

        // Log request
        print("📤 \(method) \(url.absoluteString)")
        if let bodyData = request.httpBody, let bodyString = String(data: bodyData, encoding: .utf8) {
            print("📦 Body: \(bodyString)")
        }

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.noData
            }

            // Log response
            print("📥 Response: \(httpResponse.statusCode)")
            if let responseString = String(data: data, encoding: .utf8) {
                print("📦 Data: \(responseString)")
            }

            // Handle status codes
            switch httpResponse.statusCode {
            case 200...299:
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                do {
                    return try decoder.decode(T.self, from: data)
                } catch {
                    print("❌ Decoding error: \(error)")
                    throw APIError.decodingError(error)
                }
            case 401:
                // Unauthorized - clear token and throw
                KeychainService.shared.delete(forKey: Constants.sessionTokenKey)
                throw APIError.unauthorized
            default:
                // Try to decode error message
                if let errorResponse = try? JSONDecoder().decode([String: String].self, from: data),
                   let errorMessage = errorResponse["error"] {
                    throw APIError.serverError(errorMessage)
                }
                throw APIError.serverError("Server error: \(httpResponse.statusCode)")
            }
        } catch let error as APIError {
            throw error
        } catch {
            print("❌ Network error: \(error)")
            throw APIError.networkError(error)
        }
    }

    // MARK: - Convenience Methods
    func get<T: Decodable>(_ endpoint: String, queryItems: [URLQueryItem]? = nil, requiresAuth: Bool = true) async throws -> T {
        return try await request(endpoint: endpoint, method: "GET", queryItems: queryItems, requiresAuth: requiresAuth)
    }

    func post<T: Decodable>(_ endpoint: String, body: Encodable? = nil, requiresAuth: Bool = true) async throws -> T {
        return try await request(endpoint: endpoint, method: "POST", body: body, requiresAuth: requiresAuth)
    }

    func put<T: Decodable>(_ endpoint: String, body: Encodable? = nil, queryItems: [URLQueryItem]? = nil, requiresAuth: Bool = true) async throws -> T {
        return try await request(endpoint: endpoint, method: "PUT", body: body, queryItems: queryItems, requiresAuth: requiresAuth)
    }

    func delete<T: Decodable>(_ endpoint: String, queryItems: [URLQueryItem]? = nil, requiresAuth: Bool = true) async throws -> T {
        return try await request(endpoint: endpoint, method: "DELETE", queryItems: queryItems, requiresAuth: requiresAuth)
    }
}
