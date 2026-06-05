# Kintsugi SDK —— kotlinx.serialization 反射保护

-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keep,includedescriptorclasses class com.kintsugi.**$$serializer { *; }
-keepclassmembers class com.kintsugi.** {
    *** Companion;
}
-keepclasseswithmembers class com.kintsugi.** {
    kotlinx.serialization.KSerializer serializer(...);
}
