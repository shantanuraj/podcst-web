package app.podcst.feature.library

import app.podcst.model.EpisodeList

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.R as DesignR

@Composable
internal fun ListTile(icon: ImageVector, size: Dp, corner: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(corner)).background(Podcst.colors.accentSubtle),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(size * 0.5f), tint = Podcst.colors.accent)
    }
}

internal val EpisodeList.icon: ImageVector
    get() = when (this) {
        EpisodeList.Starred -> PodcstIcons.StarFilled
        EpisodeList.Downloads -> PodcstIcons.Download
        EpisodeList.NewReleases -> PodcstIcons.Feed
    }

internal val EpisodeList.title: Int
    get() = when (this) {
        EpisodeList.Starred -> DesignR.string.starred
        EpisodeList.Downloads -> R.string.downloads
        EpisodeList.NewReleases -> R.string.new_releases
    }
