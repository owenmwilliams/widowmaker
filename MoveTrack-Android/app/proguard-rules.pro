# Release-build shrink/obfuscation rules.
#
# kotlinx.serialization generates @Serializable companion serializers reflectively
# referenced by name; R8 must keep them or JSON decode blows up at runtime.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class dev.we3kings.nexusmoves.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep, includedescriptorclasses class dev.we3kings.nexusmoves.**$$serializer { *; }
-keepclassmembers class dev.we3kings.nexusmoves.** {
    *** Companion;
}

# OkHttp / Okio ship their own consumer rules, but silence the platform warnings.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
