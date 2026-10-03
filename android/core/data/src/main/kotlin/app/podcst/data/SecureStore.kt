package app.podcst.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.podcst.network.SessionCookieStore
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context, name: String) : SessionCookieStore {
    private val file = File(context.noBackupFilesDir, "$name.secret")
    private val alias = "podcst.$name"
    @Volatile private var cached: String? = null
    @Volatile private var loaded = false

    @Synchronized
    override fun read(): String? {
        if (!loaded) {
            cached = runCatching { decrypt(file.readBytes()) }.getOrNull()
            loaded = true
        }
        return cached
    }

    @Synchronized
    override fun write(value: String) {
        if (loaded && cached == value) return
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeBytes(encrypt(value))
        temporary.renameTo(file)
        cached = value
        loaded = true
    }

    @Synchronized
    override fun clear() {
        file.delete()
        cached = null
        loaded = true
    }

    private fun encrypt(value: String): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + cipher.doFinal(value.toByteArray())
    }

    private fun decrypt(bytes: ByteArray): String {
        val ivLength = bytes[0].toInt()
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 1, ivLength))
        }
        return String(cipher.doFinal(bytes, 1 + ivLength, bytes.size - 1 - ivLength))
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
        }.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
