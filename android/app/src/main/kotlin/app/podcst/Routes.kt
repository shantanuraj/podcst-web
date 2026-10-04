package app.podcst

import androidx.navigation3.runtime.NavKey
import app.podcst.model.Episode
import app.podcst.model.EpisodeList
import app.podcst.model.Podcast
import kotlinx.serialization.Serializable

@Serializable sealed interface Route : NavKey

@Serializable data object DiscoverRoute : Route

@Serializable data object SearchRoute : Route

@Serializable data object LibraryRoute : Route

@Serializable data object QueueRoute : Route

@Serializable data object SettingsRoute : Route

@Serializable data class PodcastRoute(val podcast: Podcast) : Route

@Serializable data class EpisodeRoute(val episode: Episode) : Route

@Serializable data class EpisodeListRoute(val list: EpisodeList) : Route
