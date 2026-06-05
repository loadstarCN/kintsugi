// 根工程级 build.gradle.kts
// 具体 Library Module 在 kintsugi/build.gradle.kts

plugins {
  id("com.android.library") version "8.9.1" apply false
  id("org.jetbrains.kotlin.android") version "2.0.21" apply false
  id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
}
