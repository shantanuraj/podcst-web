package app.podcst.designsystem

import android.content.Context
import android.content.Intent

fun Context.share(text: String, title: String? = null) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).apply { title?.let { putExtra(Intent.EXTRA_TITLE, it) } }
    startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
