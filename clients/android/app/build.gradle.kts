plugins {
    id("com.android.application")
}

android {
    namespace = "work.heartful.canvas"
    compileSdk = 36

    defaultConfig {
        applicationId = "work.heartful.canvas"
        minSdk = 29
        targetSdk = 36
        versionCode = 3
        versionName = "0.2.1-native"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}
