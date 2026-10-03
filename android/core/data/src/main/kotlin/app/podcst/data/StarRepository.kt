package app.podcst.data

import app.podcst.database.StarEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.Episode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map

class StarRepository(
    private val scopes: Scopes,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val starred: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observeStarred().map { rows -> rows.map { it.domain() } }
    }

    val identities: Flow<Set<String>> = scopes.current.flatMapLatest { scope ->
        scope.database.stars().observeIdentities().map { it.toSet() }
    }

    suspend fun star(episode: Episode) {
        val database = scopes.database
        database.episodes().upsert(listOf(episode.entity()))
        database.stars().star(StarEntity(episode.identity.value, clock()))
    }

    suspend fun unstar(episode: Episode) = scopes.database.stars().unstar(episode.identity.value)

    suspend fun toggle(identity: String) {
        val database = scopes.database
        if (database.stars().contains(identity)) database.stars().unstar(identity)
        else database.stars().star(StarEntity(identity, clock()))
    }
}
