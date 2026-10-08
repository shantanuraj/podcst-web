package app.podcst.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

object CatalogueId : KSerializer<Long> {
    override val descriptor = PrimitiveSerialDescriptor("CatalogueId", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): Long = StateIDSerializer.deserialize(decoder).value.toLong()
    override fun serialize(encoder: Encoder, value: Long) = StateIDSerializer.serialize(encoder, StateID(value.toString()))
}
