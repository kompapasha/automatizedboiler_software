//  function updateCurrentTime() {
//    const now = new Date();
//    const hours = now.getHours().toString().padStart(2, '0');
//    const minutes = now.getMinutes().toString().padStart(2, '0');
//
//    document.querySelector('.time-hours').textContent = hours;
//    document.querySelector('.time-minutes').textContent = minutes;
//  }
//
//  // Оновити час одразу після завантаження
//  updateCurrentTime();
//
//  // Оновлювати щохвилини (перевірка кожну секунду, але оновлення тільки при зміні хвилини)
//  let lastMinute = new Date().getMinutes();
//  setInterval(() => {
//    const currentMinute = new Date().getMinutes();
//    if (currentMinute !== lastMinute) {
//      lastMinute = currentMinute;
//      updateCurrentTime();
//    }
//  }, 1000);














