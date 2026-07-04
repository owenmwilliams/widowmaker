package dev.we3kings.nexusmoves.data.api

import dev.we3kings.nexusmoves.data.Constants
import dev.we3kings.nexusmoves.data.auth.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * HTTP layer for the plain JSON auth/user API — port of iOS APIClient.swift.
 * (The SSE + upload + scan-job surface lives in NexusService, mirroring the iOS
 * split, because those use camelCase and streaming while this uses snake_case.)
 *
 * Endpoints:
 *   POST /auth/request-code   { email }
 *   POST /auth/verify-code    { email, code } → { sessionToken, user }
 *   GET  /auth/me             → { user }
 *   POST /auth/logout
 *
 * Error contract (port of iOS): 401 → clear token + throw [ApiError.Unauthorized]
 * (a real logout); 5xx/network → retryable, NEVER a logout.
 */
object ApiClient {
    val BASE_URL: String = Constants.apiBaseURL

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    private val jsonMedia = "application/json".toMediaType()

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Run a request and return the raw success body, or throw a typed [ApiError].
     * Reified helpers below decode it. Blocking OkHttp call hops to the IO pool.
     */
    suspend fun exchange(
        method: String,
        endpoint: String,
        jsonBody: String? = null,
        requiresAuth: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url(BASE_URL + endpoint)
            .header("Content-Type", "application/json")

        if (requiresAuth) {
            TokenStore.sessionToken?.let { builder.header("Authorization", "Bearer $it") }
        }

        when (method) {
            "GET" -> builder.get()
            "DELETE" -> builder.delete(jsonBody?.toRequestBody(jsonMedia))
            else -> builder.method(method, (jsonBody ?: "").toRequestBody(jsonMedia))
        }

        val response = try {
            http.newCall(builder.build()).execute()
        } catch (e: Exception) {
            throw ApiError.NetworkError(e)
        }

        response.use {
            val bodyText = it.body?.string() ?: ""
            when {
                it.code in 200..299 -> bodyText
                it.code == 401 -> {
                    // Real 401 — the token is bad. Clear it and signal the one
                    // case that ends the session.
                    TokenStore.clear()
                    throw ApiError.Unauthorized
                }
                else -> throw ApiError.ServerError(
                    errorMessage(bodyText) ?: "Server error: ${it.code}"
                )
            }
        }
    }

    /** Pull a top-level `error` string out of a JSON error body, if present. */
    private fun errorMessage(body: String): String? = try {
        (json.parseToJsonElement(body) as? JsonObject)?.get("error")?.jsonPrimitive?.content
    } catch (_: Exception) {
        null
    }

    suspend inline fun <reified T> get(endpoint: String, requiresAuth: Boolean = true): T =
        decode(exchange("GET", endpoint, null, requiresAuth))

    suspend inline fun <reified T> post(
        endpoint: String,
        jsonBody: String? = null,
        requiresAuth: Boolean = true,
    ): T = decode(exchange("POST", endpoint, jsonBody, requiresAuth))

    inline fun <reified T> decode(body: String): T = try {
        json.decodeFromString(body)
    } catch (e: Exception) {
        throw ApiError.DecodingError(e)
    }
}
