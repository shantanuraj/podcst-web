package app.podcst.model

import kotlinx.serialization.Serializable

@Serializable
enum class EpisodeList { Starred, Downloads, NewReleases }
