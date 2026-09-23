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
        versionCode = 1
        versionName = "0.1.0"
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
