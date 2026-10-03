package app.podcst.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences as Store
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.podcst.model.AudioSettings
import app.podcst.model.Region
import java.util.Locale
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

enum class Appearance { System, Light, Dark }

private val Context.store by preferencesDataStore("preferences")

class Preferences(context: Context) {
    private val store = context.store

    val appearance: Flow<Appearance> = read { prefs ->
        prefs[APPEARANCE]?.let { runCatching { Appearance.valueOf(it) }.getOrNull() } ?: Appearance.System
    }

    val region: Flow<Region> = read { prefs -> Region.of(prefs[REGION]) ?: Region.detected(Locale.getDefault().country) }

    val onboarded: Flow<Boolean> = read { prefs -> prefs[ONBOARDED] ?: false }

    val recentSearches: Flow<List<String>> = read { prefs ->
        prefs[RECENT]?.split('\n')?.filter { it.isNotEmpty() }.orEmpty()
    }

    val audio: Flow<AudioSettings> = read { prefs ->
        prefs[AUDIO]?.let { runCatching { json.decodeFromString<AudioSettings>(it).validated() }.getOrNull() } ?: AudioSettings()
    }

    suspend fun audioSettings(): AudioSettings = audio.first()

    suspend fun setAppearance(value: Appearance) {
        store.edit { it[APPEARANCE] = value.name }
    }

    suspend fun setRegion(value: Region) {
        store.edit { it[REGION] = value.code }
    }

    suspend fun setOnboarded() {
        store.edit { it[ONBOARDED] = true }
    }

    suspend fun remember(term: String) {
        store.edit { prefs ->
        val recent = prefs[RECENT]?.split('\n')?.filter { it.isNotEmpty() }.orEmpty()
        prefs[RECENT] = (listOf(term) + recent.filterNot { it.equals(term, ignoreCase = true) }).take(RECENT_LIMIT).joinToString("\n")
        }
    }

    suspend fun clearRecent() {
        store.edit { it.remove(RECENT) }
    }

    suspend fun updateAudio(transform: (AudioSettings) -> AudioSettings) {
        store.edit { prefs ->
        val current = prefs[AUDIO]?.let { runCatching { json.decodeFromString<AudioSettings>(it).validated() }.getOrNull() } ?: AudioSettings()
        prefs[AUDIO] = json.encodeToString(AudioSettings.serializer(), transform(current))
        }
    }

    private fun <T> read(transform: (Store) -> T): Flow<T> = store.data.map(transform).distinctUntilChanged()

    private companion object {
        const val RECENT_LIMIT = 8
        val APPEARANCE = stringPreferencesKey("appearance")
        val REGION = stringPreferencesKey("region")
        val ONBOARDED = booleanPreferencesKey("onboarded")
        val RECENT = stringPreferencesKey("recentSearches")
        val AUDIO = stringPreferencesKey("audio")
        val json = Json { ignoreUnknownKeys = true }
    }
}
