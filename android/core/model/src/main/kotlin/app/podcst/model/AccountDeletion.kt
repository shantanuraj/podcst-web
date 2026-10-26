package app.podcst.model

import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

@Serializable
data class DeletionPreparation(
    val accountId: String,
    val operationId: String,
    val receipt: String? = null,
    val expiresAt: String,
    val proofExpiresAt: String,
) {
    fun validate(account: String, needsReceipt: Boolean = true) {
        require(accountId == account && UUID.fromString(operationId).toString() == operationId.lowercase())
        require((!needsReceipt && receipt == null) || receipt?.matches(Regex("[A-Za-z0-9_-]{43}")) == true)
        require(Instant.parse(expiresAt) > Instant.parse(proofExpiresAt))
    }
}

@Serializable
data class DeletionOutcome(val status: String, val operationId: String? = null) {
    fun validate() { require(status in setOf("pending", "completed", "unknown")) }
}

@Serializable
data class AccountDeletion(
    val accountId: String,
    val preparation: DeletionPreparation? = null,
    val outcome: String? = null,
    val cleanup: Cleanup? = null,
) {
    @Serializable enum class Cleanup { Retire, Credentials, Media, Data, Complete }

    fun validate() {
        require(accountId.isNotEmpty())
        require(outcome == null || outcome in setOf("pending", "completed", "unknown"))
        require((outcome == "completed") == (cleanup != null))
        require(outcome == null || preparation != null)
        preparation?.validate(accountId, needsReceipt = outcome != "completed")
    }
}
