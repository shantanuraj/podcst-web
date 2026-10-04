package app.podcst.designsystem

fun Format.speed(value: Double): String = "${value.toBigDecimal().stripTrailingZeros().toPlainString()}×"
