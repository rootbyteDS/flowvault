package de.flown8tive.flowvault.notify.data

import de.flown8tive.flowvault.notify.model.ApiErrorDto
import de.flown8tive.flowvault.notify.model.BootstrapDto
import de.flown8tive.flowvault.notify.model.DeviceDto
import de.flown8tive.flowvault.notify.model.DeviceUpdateDto
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.MessagesResponseDto
import de.flown8tive.flowvault.notify.model.PairRequestDto
import de.flown8tive.flowvault.notify.model.PairedResponseDto
import de.flown8tive.flowvault.notify.model.ReadRequestDto
import de.flown8tive.flowvault.notify.model.RuleDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : IOException(message)

class FlowVaultApi {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    private val sseClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // Offener Event-Stream
        .retryOnConnectionFailure(true)
        .followRedirects(false)
        .build()

    private fun buildUrl(baseUrl: String, path: String, query: Map<String, String> = emptyMap()): String {
        val base = "${baseUrl.trimEnd('/')}/mobile/v1$path"
        val parsed = base.toHttpUrlOrNull() ?: throw ApiException(0, "Ungültige Server-URL: $baseUrl")
        val b = parsed.newBuilder()
        query.forEach { (k, v) -> b.addQueryParameter(k, v) }
        return b.build().toString()
    }

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val msg = runCatching { FlowVaultJson.decodeFromString<ApiErrorDto>(raw).error }.getOrNull()
                throw ApiException(res.code, msg ?: "HTTP ${res.code}")
            }
            if (T::class == Unit::class) return@use Unit as T
            FlowVaultJson.decodeFromString<T>(raw)
        }
    }

    private fun authRequest(baseUrl: String, token: String, path: String, query: Map<String, String> = emptyMap()): Request.Builder =
        Request.Builder()
            .url(buildUrl(baseUrl, path, query))
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")

    suspend fun pair(serverUrl: String, code: String, deviceName: String): PairedResponseDto {
        val body = FlowVaultJson.encodeToString(PairRequestDto(code = code, deviceName = deviceName)).toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(buildUrl(serverUrl, "/pair"))
            .header("Accept", "application/json")
            .post(body)
            .build()
        return execute(req)
    }

    suspend fun bootstrap(serverUrl: String, token: String): BootstrapDto =
        execute(authRequest(serverUrl, token, "/bootstrap").get().build())

    suspend fun fetchMessages(
        serverUrl: String,
        token: String,
        after: Long? = null,
        before: Long? = null,
        instanceId: Int? = null,
        limit: Int = 100,
    ): MessagesResponseDto {
        val q = buildMap {
            if (after != null) put("after", after.toString())
            if (before != null) put("before", before.toString())
            if (instanceId != null) put("instance", instanceId.toString())
            put("limit", limit.toString())
        }
        return execute(authRequest(serverUrl, token, "/messages", q).get().build())
    }

    suspend fun markRead(serverUrl: String, token: String, instanceId: Int, readSeq: Long) {
        val body = FlowVaultJson.encodeToString(ReadRequestDto(instanceId, readSeq)).toRequestBody(jsonMediaType)
        execute<Unit>(authRequest(serverUrl, token, "/read").post(body).build())
    }

    suspend fun updateDevice(serverUrl: String, token: String, patch: DeviceUpdateDto): DeviceDto {
        val body = FlowVaultJson.encodeToString(patch).toRequestBody(jsonMediaType)
        return execute(authRequest(serverUrl, token, "/device").put(body).build())
    }

    suspend fun upsertRule(serverUrl: String, token: String, rule: RuleDto): RuleDto {
        val body = FlowVaultJson.encodeToString(rule).toRequestBody(jsonMediaType)
        return execute(authRequest(serverUrl, token, "/rules").put(body).build())
    }

    suspend fun dismissAlert(serverUrl: String, token: String, alertId: Int) {
        val body = "{}".toRequestBody(jsonMediaType)
        execute<Unit>(authRequest(serverUrl, token, "/alerts/$alertId/dismiss").post(body).build())
    }

    suspend fun unpair(serverUrl: String, token: String) {
        execute<Unit>(authRequest(serverUrl, token, "/device").delete().build())
    }

    fun openStream(
        serverUrl: String,
        token: String,
        afterSeq: Long,
        onConnected: () -> Unit,
        onMessage: (MessageDto, Boolean) -> Unit,
        onFailure: (Throwable?) -> Unit,
    ): EventSource {
        val req = Request.Builder()
            .url(buildUrl(serverUrl, "/stream", mapOf("after" to afterSeq.toString())))
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .header("Last-Event-ID", afterSeq.toString())
            .get()
            .build()

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                onConnected()
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                when (type) {
                    "message", "message_updated" -> {
                        val dto = runCatching { FlowVaultJson.decodeFromString<MessageDto>(data) }.getOrNull() ?: return
                        onMessage(dto, type == "message")
                    }
                    "ready" -> onConnected()
                }
            }

            override fun onClosed(eventSource: EventSource) {
                onFailure(null)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                onFailure(t ?: IOException("Stream HTTP ${response?.code ?: 0}"))
            }
        }
        return EventSources.createFactory(sseClient).newEventSource(req, listener)
    }
}
