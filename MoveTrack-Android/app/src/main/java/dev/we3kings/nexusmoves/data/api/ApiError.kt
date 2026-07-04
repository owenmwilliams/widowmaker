package dev.we3kings.nexusmoves.data.api

/**
 * Port of iOS APIClient.APIError. The critical distinction is [Unauthorized]
 * (a real 401 → the token is bad, session over) vs everything else (network,
 * server 5xx → retryable, NEVER a logout). This is the client half of the
 * "only a real 401 logs out" contract (iOS PR #66 / server PR #62).
 */
sealed class ApiError(message: String) : Exception(message) {
    object InvalidURL : ApiError("Invalid URL")
    object Unauthorized : ApiError("Unauthorized - Please log in again")
    class ServerError(val serverMessage: String) : ApiError(serverMessage)
    class NetworkError(cause: Throwable) : ApiError("Network error: ${cause.message}")
    class DecodingError(cause: Throwable) : ApiError("Failed to decode response: ${cause.message}")
}
