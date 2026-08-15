<template>
  <v-app class="liquid-bg">
    <v-main class="d-flex align-center justify-center" style="min-height: 100vh;">
      <v-container style="max-width: 450px;">
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
/*
  Class .liquid-bg trước đây không được định nghĩa ở đâu cả — trang đăng nhập
  hiển thị nền trắng trơn, lệch với canvas xám nhạt của app. Giờ dùng canvas
  + 2 vệt gradient xanh lá nhạt cho đồng bộ design system.
*/
.liquid-bg {
  background:
    radial-gradient(900px 500px at 15% 12%, rgba(34, 197, 94, 0.16), transparent 60%),
    radial-gradient(800px 460px at 85% 88%, rgba(22, 163, 74, 0.12), transparent 60%),
    #eceef0;
}

.liquid-bg :deep(.v-main) {
  background: transparent;
}

.liquid-bg :deep(.v-card) {
  border-radius: 28px;
  border: none;
  box-shadow: 0 14px 34px rgba(17, 24, 39, 0.1);
}
</style>
