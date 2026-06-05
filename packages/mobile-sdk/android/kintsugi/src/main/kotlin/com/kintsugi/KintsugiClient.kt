package com.kintsugi

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Kintsugi Android SDK —— 对齐 @kintsugi/sdk / KintsugiKit.swift 的 Instant API 形状。
 *
 * 用法:
 *   val client = KintsugiClient(
 *       baseUrl = "https://api.kintsugi.example.com",
 *       appCode = "app-demo0001",
 *       auth = KintsugiAuth.Token("eyJ...")
 *   )
 *   val result = client.filter("dsxxxx", FilterRequest(pageSize = 20))
 */
sealed class KintsugiAuth {
    data object None : KintsugiAuth()
    data class Token(val token: String) : KintsugiAuth()
    data class AccessKey(val accessKey: String, val secretKey: String) : KintsugiAuth()
}

class KintsugiClient(
    val baseUrl: String,
    val appCode: String,
    val auth: KintsugiAuth = KintsugiAuth.None,
    val httpClient: OkHttpClient = OkHttpClient(),
    val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = false },
) {
    private val jsonMt = "application/json; charset=utf-8".toMediaType()

    suspend inline fun <reified T> filter(
        datasetCode: String,
        body: FilterRequest = FilterRequest(),
    ): FilterResult<T> =
        request("POST", "/api/apps/$appCode/ds/$datasetCode/filter", json.encodeToString(body))

    suspend inline fun <reified T> getOne(datasetCode: String, id: String): T =
        request("GET", "/api/apps/$appCode/ds/$datasetCode/$id", null)

    suspend inline fun <reified T, reified U> create(datasetCode: String, data: U): T =
        request("POST", "/api/apps/$appCode/ds/$datasetCode", json.encodeToString(data))

    suspend inline fun <reified T, reified U> update(datasetCode: String, id: String, data: U): T =
        request("PATCH", "/api/apps/$appCode/ds/$datasetCode/$id", json.encodeToString(data))

    suspend fun delete(datasetCode: String, id: String): DeleteResult =
        request("DELETE", "/api/apps/$appCode/ds/$datasetCode/$id", null)

    suspend fun askChats(question: String): ChatsAskResult {
        val body = json.encodeToString(ChatsAskRequest(appCode, question, null))
        return request("POST", "/api/chats/ask", body)
    }

    suspend inline fun <reified T> request(method: String, path: String, jsonBody: String?): T {
        val text = requestRaw(method, path, jsonBody)
        return json.decodeFromString(text)
    }

    suspend fun requestRaw(method: String, path: String, jsonBody: String?): String = withContext(Dispatchers.IO) {
        val url = baseUrl.trimEnd('/') + path
        val reqBuilder = Request.Builder().url(url)

        val body: String = jsonBody ?: ""
        when (method.uppercase()) {
            "GET" -> reqBuilder.get()
            "DELETE" -> reqBuilder.delete(body.toRequestBody(jsonMt))
            else -> reqBuilder.method(method.uppercase(), body.toRequestBody(jsonMt))
        }

        when (auth) {
            is KintsugiAuth.None -> Unit
            is KintsugiAuth.Token -> reqBuilder.header("Authorization", "Bearer ${auth.token}")
            is KintsugiAuth.AccessKey -> {
                val ts = (System.currentTimeMillis() / 1000).toString()
                val nonce = UUID.randomUUID().toString().replace("-", "").substring(0, 16).lowercase()
                val canonical = "${method.uppercase()}\n$path\n$ts\n$nonce\n$body"
                val sig = hmacSha256(auth.secretKey, canonical)
                reqBuilder.header("X-Access-Key", auth.accessKey)
                    .header("X-Timestamp", ts)
                    .header("X-Nonce", nonce)
                    .header("X-Signature", sig)
            }
        }

        httpClient.newCall(reqBuilder.build()).execute().use { res ->
            val txt = res.body?.string() ?: ""
            if (!res.isSuccessful) throw KintsugiHttpException(res.code, txt)
            txt
        }
    }

    private fun hmacSha256(key: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return mac.doFinal(message.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

class KintsugiHttpException(val status: Int, val body: String) :
    RuntimeException("HTTP $status: ${body.take(200)}")

// ---- DTOs ----
@Serializable
data class FilterClause(val field: String, val op: String, val value: JsonElement? = null)

@Serializable
data class SortOrder(val field: String, val direction: String? = null)

@Serializable
data class FilterRequest(
    @SerialName("where") val wheres: List<FilterClause>? = null,
    val orderBy: List<SortOrder>? = null,
    val page: Int? = null,
    val pageSize: Int? = null,
    val select: List<String>? = null,
    val includeDeleted: Boolean? = null,
)

@Serializable
data class FilterResult<T>(
    val data: List<T>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
)

@Serializable
data class DeleteResult(val ok: Boolean, val softDeleted: Boolean)

@Serializable
data class ChatsAskRequest(val appCode: String, val question: String, val maxTables: Int?)

@Serializable
data class ChatsAskResult(
    val sql: String,
    val explanation: String,
    val rowCount: Int,
)
