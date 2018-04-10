<template>
  <div>
    <div>My blog navigation </div>
    <nuxt/>
  </div>
</template>

<script>
export default {
  asyncData(ab) {
    console.log(ab);
  },
};
</script>
