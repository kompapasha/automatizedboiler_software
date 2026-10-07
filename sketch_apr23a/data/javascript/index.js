// ======== ГОЛОВНИЙ ФАЙЛ - main.js ========
// Об'єднує всю функціональність в одному файлі

// ======== Глобальні змінні ========
let counter = 0;
let websocket = null;
const gateway = `ws://${window.location.hostname}/ws`;

// ======== WebSocket функції ========
function initWebSocket() {
    console.log('🔌 Opening WebSocket connection...');
    websocket = new WebSocket(gateway);
    
    websocket.onopen = () => {
        console.log('✅ WebSocket connection opened');
        
        // Відправляємо часовий пояс
        const timezoneOffset = new Date().getTimezoneOffset() * -1;
        websocket.send(JSON.stringify({
            type: "setTimezone",
            timezoneOffset: timezoneOffset
        }));
        
        // Запитуємо поточний розклад
        websocket.send(JSON.stringify({
            type: "getSchedule"
        }));
    };
    
    websocket.onclose = () => {
        console.log('⚠️ WebSocket connection closed. Reconnecting...');
        setTimeout(initWebSocket, 2000);
    };
    
    websocket.onmessage = function(event) {
        try {
            const msg = JSON.parse(event.data);
            handleWebSocketMessage(msg);
        } catch (e) {
            console.warn("❌ Invalid WS message:", event.data);
        }
    };
}

function handleWebSocketMessage(msg) {
  console.log("📨 Отримано повідомлення:", msg.type, msg);
  switch (msg.type) {
    case "boilerStats":
      processBoilerStats(msg);
      break;
            
    case "boilerStatus":
      updateBoilerStatus(msg);
      break;
            
    case "schedule":
      if (Array.isArray(msg.data)) {
        console.log("📥 Отримано розклад з ESP:", msg.data);
        loadSchedulesFromServer(msg.data);
      }
      break;
    
    default:
      console.log("⚠️ Невідомий тип повідомлення:", msg.type);
    }
}

// ======== Керування розкладами ========
function addSchedule() {
    const hBefore = parseInt(document.getElementById('uhourbefore').value);
    const mBefore = parseInt(document.getElementById('uminutebefore').value);
    const hAfter = parseInt(document.getElementById('uhourafter').value);
    const mAfter = parseInt(document.getElementById('uminuteafter').value);

    const schedule = {
        id: Date.now(),
        before: { hour: hBefore, minute: mBefore },
        after: { hour: hAfter, minute: mAfter },
        active: true
    };

    console.log("➕ Додаємо новий розклад:", schedule);
    
    appendScheduleToDOM(schedule);
    
    sendSchedulesToESP();
    
    popUpActivation();
}

function appendScheduleToDOM(schedule) {
    const wrapper = document.querySelector('.dates-group-wrapper');
    const newSection = document.createElement('section');
    newSection.className = 'date-setted';
    newSection.setAttribute('data-id', schedule.id);

    newSection.innerHTML = `
        <section class="date-setted-content-switch">
            <label for="ucheck${++counter}" class="switch">
                <input type="checkbox" hidden id="ucheck${counter}" name="ucheck${counter}" ${schedule.active ? "checked" : ""}>
                <span class="switch-button"></span>
            </label>
        </section>
        <section class="date-setted-content-time">
            <div class="time-before">
                <span class="time-before-hours">${pad(schedule.before.hour)}</span>
                <span>:</span>
                <span class="time-before-minutes">${pad(schedule.before.minute)}</span>
            </div>
            <div class="time-dots">-</div>
            <div class="time-after">
                <span class="time-after-hours">${pad(schedule.after.hour)}</span>
                <span>:</span>
                <span class="time-after-minutes">${pad(schedule.after.minute)}</span>
            </div>
        </section>
        <section class="date-setted-delete-button">
            <button type="button" onclick="deleteSchedule(${schedule.id})">
                <i class="fa-solid fa-minus"></i>
            </button>
        </section>
    `;
    wrapper.appendChild(newSection);
}

function deleteSchedule(id) {
    const section = document.querySelector(`.date-setted[data-id="${id}"]`);
    if (section) {
        section.remove();
        sendSchedulesToESP();
    }
}

function sendSchedulesToESP() {
    const entries = document.querySelectorAll('.date-setted');
    const data = [];

    entries.forEach(section => {
        const id = parseInt(section.getAttribute('data-id'));
        const beforeHour = parseInt(section.querySelector('.time-before-hours').textContent);
        const beforeMinute = parseInt(section.querySelector('.time-before-minutes').textContent);
        const afterHour = parseInt(section.querySelector('.time-after-hours').textContent);
        const afterMinute = parseInt(section.querySelector('.time-after-minutes').textContent);
        const checkbox = section.querySelector('input[type="checkbox"]');
        const isActive = checkbox.checked;

        data.push({
            id: id,
            active: isActive,
            before: { hour: beforeHour, minute: beforeMinute },
            after: { hour: afterHour, minute: afterMinute }
        });
    });

    console.log("📤 Відправляємо розклади на ESP:", data);

    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ 
            type: "schedules", 
            payload: data 
        }));
    }
}

function loadSchedulesFromServer(schedules) {
    clearAllSchedules();
    schedules.forEach(schedule => {
        const clientSchedule = {
            id: schedule.id,
            before: { 
                hour: schedule.beforeHour || schedule.before?.hour, 
                minute: schedule.beforeMinute || schedule.before?.minute 
            },
            after: { 
                hour: schedule.afterHour || schedule.after?.hour, 
                minute: schedule.afterMinute || schedule.after?.minute 
            },
            active: schedule.active
        };
        console.log("🔄 Перетворено розклад:", schedule, "->", clientSchedule);
        appendScheduleToDOM(clientSchedule);
    });
}

function clearAllSchedules() {
    document.querySelectorAll('.date-setted').forEach(el => el.remove());
}

function deleteAllSchedule() {
    if (!confirm("❗ Ви впевнені, що хочете очистити весь розклад?")) return;

    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            type: "clearSchedule"
        }));
    }

    clearAllSchedules();
}

// ======== Ручне керування ========
function setupManualControl() {
  const checkbox = document.getElementById('manualControlCheckbox');
  if (!checkbox) {
    console.warn("❌ Manual control checkbox not found!");
    return;
  }
    
  checkbox.addEventListener('change', () => {
    const isChecked = checkbox.checked;
        
    console.log("🎛️ Користувач змінив ручне керування на:", isChecked);
        
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      if (isChecked) {
        websocket.send(JSON.stringify({
          type: "manualControl",
          enabled: true
        }));
                
        setTimeout(() => {
          websocket.send(JSON.stringify({
            type: "toggleManualRelay"
          }));
        }, 100);
                
        console.log("📤 Відправлено manualControl: true + toggleManualRelay");
      } else {
        websocket.send(JSON.stringify({
          type: "manualControl",
          enabled: false
        }));
        console.log("📤 Відправлено manualControl: false");
      }
    } else {
      console.warn("⚠️ WebSocket не підключений!");
    }
  });
}

function updateBoilerStatus(status) {
  console.log("🔄 Оновлення статусу котла:", status);
  updateBoilerStatusText(status.boilerState);
    
  const manualCheckbox = document.getElementById('manualControlCheckbox');
  if (manualCheckbox) {
    console.log("📊 Поточний стан:", {
      boilerState: status.boilerState,
      manualControl: status.manualControl,
      scheduleActive: status.scheduleActive
    });
        
    // Чекбокс завжди доступний, показує стан ручного керування
    manualCheckbox.disabled = false;
    manualCheckbox.checked = status.manualControl;
        
    console.log("🎛️ Manual control checkbox:", status.manualControl);
  }
}

function updateBoilerStatusText(isOn) {
    const el = document.getElementById("boiler-status");
    if (el) {
        el.textContent = isOn ? "On" : "Off";
        el.style.color = isOn ? "green" : "red";
    }
}

// ======== Статистика ========
function drawBoilerLog(from, to) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            type: "getBoilerStats",
            from: from,
            to: to
        }));
    }
}

function processBoilerStats(data) {
    const stats = data.stats;
    const events = [];

    // Додаємо початковий стан OFF якщо перший запис ON
    if (stats.length && stats[0].state === true) {
        stats.unshift({
            timestamp: stats[0].timestamp - 60,
            state: false
        });
    }

    // Знаходимо періоди увімкнення (ON -> OFF)
    for (let i = 0; i < stats.length - 1; i++) {
        const current = stats[i];
        const next = stats[i + 1];

        if (current.state === true && next.state === false) {
            events.push({
                x: new Date(current.timestamp * 1000),
                x2: new Date(next.timestamp * 1000)
            });
        }
    }

    if (!events.length) {
        Plotly.newPlot('logChart', [], { 
            title: 'Немає увімкнень у вказаний період' 
        });
        return;
    }

    const minTimestamp = stats[0].timestamp * 1000;
    const maxTimestamp = stats[stats.length - 1].timestamp * 1000;

    const shapes = events.map(event => ({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: event.x,
        x1: event.x2,
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(0, 200, 0, 0.3)',
        line: { width: 0 }
    }));

    const layout = {
        title: 'Історія роботи бойлера',
        shapes: shapes,
        xaxis: {
            range: [minTimestamp, maxTimestamp],
            tickformat: "%H:%M\n%d %b",
            tickangle: -45,
            tickfont: { size: 10 },
            automargin: true,
            type: 'date'
        },
        yaxis: {
            visible: false
        },
        margin: { t: 40, b: 80 }
    };

    Plotly.newPlot('logChart', [], layout);
}

function getUnixTimeRangeFromInputs(dateAfterId, timeAfterId, dateBeforeId, timeBeforeId) {
    const dateAfter = document.getElementById(dateAfterId).value;
    const timeAfter = document.getElementById(timeAfterId).value;
    const dateBefore = document.getElementById(dateBeforeId).value;
    const timeBefore = document.getElementById(timeBeforeId).value;

    if (!dateBefore || !timeBefore || !dateAfter || !timeAfter) {
        return { valid: false };
    }

    const fromLocal = new Date(`${dateAfter}T${timeAfter}`);
    const toLocal = new Date(`${dateBefore}T${timeBefore}`);

    const from = Math.floor(fromLocal.getTime() / 1000);
    const to = Math.floor(toLocal.getTime() / 1000);

    if (isNaN(from) || isNaN(to) || from >= to) {
        return { valid: false };
    }

    return { from, to, valid: true };
}

// ======== UI функції ========
function openTab(evt, btnName) {
    document.querySelectorAll(".tabcontent").forEach(el => el.style.display = "none");
    document.querySelectorAll(".tablinks").forEach(el => el.classList.remove("active"));
    
    document.getElementById(btnName).style.display = "block";
    evt.currentTarget.classList.add("active");

    localStorage.setItem("activeTab", btnName);
}

function chooseMode(event) {
    const isDark = event.target.checked;
    if (isDark) {
        document.querySelector("body").classList.add("black-theme");
        localStorage.setItem("theme", "dark"); 
    } else {
        document.querySelector("body").classList.remove("black-theme");
        localStorage.setItem("theme", "light");
    }
}

function popUpActivation() {
    const popup = document.querySelector(".pop-up-add");
    popup.classList.toggle("pop-opened");

    if (popup.classList.contains("pop-opened")) {
        setInitialTimes();
    }
}

function setInitialTimes() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    document.getElementById("uhourbefore").value = hour;
    document.getElementById("uminutebefore").value = minute;
    document.getElementById("uhourafter").value = (hour + 1) % 24;
    document.getElementById("uminuteafter").value = minute;
}

function changeTime(id, delta, min, max) {
    const input = document.getElementById(id);
    let value = parseInt(input.value) || 0;
    value += delta;
    if (value > max) value = min;
    if (value < min) value = max;
    input.value = value;
}

function validateInput(id, min, max) {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
        let val = parseInt(input.value);
        if (isNaN(val) || val < min) input.value = min;
        if (val > max) input.value = max;
    });
}

function pad(num) {
    return num.toString().padStart(2, '0');
}

// ======== Годинник ========
function updateCurrentTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    const hoursEl = document.querySelector('.time-hours');
    const minutesEl = document.querySelector('.time-minutes');
    
    if (hoursEl) hoursEl.textContent = hours;
    if (minutesEl) minutesEl.textContent = minutes;
}

function startClock() {
    updateCurrentTime();
    
    let lastMinute = new Date().getMinutes();
    setInterval(() => {
        const currentMinute = new Date().getMinutes();
        if (currentMinute !== lastMinute) {
            lastMinute = currentMinute;
            updateCurrentTime();
        }
    }, 1000);
}

// ======== Ініціалізація ========
document.addEventListener('DOMContentLoaded', () => {
    // Ініціалізація UI
    setInitialTimes();
    validateInput("uhourbefore", 0, 23);
    validateInput("uminutebefore", 0, 59);
    validateInput("uhourafter", 0, 23);
    validateInput("uminuteafter", 0, 59);
    
    // Відновлення збережених налаштувань
    const savedTab = localStorage.getItem("activeTab") || "Schedule";
    const tabButton = Array.from(document.querySelectorAll('.tablinks'))
        .find(btn => btn.textContent === savedTab);
    if (tabButton) {
        tabButton.click();
    }

    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
        document.querySelector("body").classList.add("black-theme");
        document.getElementById("darkmode").checked = true;
    }
    
    // Запуск годинника
    startClock();
});

// ======== Event Listeners ========
window.addEventListener('load', () => {
    initWebSocket();
    setupManualControl();
});

// Обробка зміни checkbox для розкладів
document.addEventListener('change', function(e) {
    if (e.target.matches('input[type="checkbox"]') && 
        e.target.closest('.date-setted')) {
        sendSchedulesToESP();
    }
});

// Обробка форми статистики
document.addEventListener('DOMContentLoaded', () => {
    const statsForm = document.querySelector('.statistics-section-content-buttons');
    if (statsForm) {
        statsForm.addEventListener('submit', (event) => {
            event.preventDefault();
            
            const { from, to, valid } = getUnixTimeRangeFromInputs(
                'statsdateafter', 'statstimeafter',
                'statsdatebefore', 'statstimebefore'
            );
            
            if (!valid) {
                alert("⚠️ Перевірте правильність діапазону часу (від < до)");
                return;
            }
            
            drawBoilerLog(from, to);
        });
    }
});

// Обробка перемикача темної теми
document.addEventListener('DOMContentLoaded', () => {
    const darkmodeToggle = document.getElementById("darkmode");
    if (darkmodeToggle) {
        darkmodeToggle.addEventListener("change", chooseMode);
    }
});







//document.getElementById("manualBoilerControl").addEventListener("change", function () {
//  const manualEnabled = this.checked;
//  websocket.send(JSON.stringify({
//    type: "manualControl",
//    value: manualEnabled
//  }));
//});

/**
 * 1. Зробити нормальні запити на видалення запису, додавання запису.
 * 2. 
 * 3. 
 * 4.
 * 5.
 * 6.
 * 
 * 
 */


/*


let websocket = null;
const gateway = `ws://${window.location.hostname}/ws`;

// ======== WebSocket функції ========
function initWebSocket() {
    console.log('🔌 Opening WebSocket connection...');
    websocket = new WebSocket(gateway);
    
    websocket.onopen = () => {
        console.log('✅ WebSocket connection opened');
        
        // Відправляємо часовий пояс
        const timezoneOffset = new Date().getTimezoneOffset() * -1;
        websocket.send(JSON.stringify({
            type: "setTimezone",
            timezoneOffset: timezoneOffset
        }));
        
        // Запитуємо поточний розклад
        websocket.send(JSON.stringify({
            type: "getSchedule"
        }));
    };
    
    websocket.onclose = () => {
        console.log('⚠️ WebSocket connection closed. Reconnecting...');
        setTimeout(initWebSocket, 2000);
    };
    
    websocket.onmessage = function(event) {
        try {
            const msg = JSON.parse(event.data);
            handleWebSocketMessage(msg);
        } catch (e) {
            console.warn("❌ Invalid WS message:", event.data);
        }
    };
}

function handleWebSocketMessage(msg) {
    switch (msg.type) {
        case "boilerStats":
            processBoilerStats(msg);
            break;
            
        case "boilerStatus":
            updateBoilerStatus(msg);
            break;
            
        case "schedule":
            if (Array.isArray(msg.data)) {
                console.log("📥 Отримано розклад з ESP:", msg.data);
                loadSchedulesFromServer(msg.data);
            }
            break;
            
        case "scheduleStatus":
            updateManualControlAvailability(msg.active);
            break;
            
        // Видалено дублікати обробки - тепер використовуємо тільки boilerStatus
        default:
            console.log("📨 Отримано повідомлення:", msg.type, msg);
    }
}

// ======== Ініціалізація ========
document.addEventListener('DOMContentLoaded', () => {
    // Ініціалізація UI
    setInitialTimes();
    validateInput("uhourbefore", 0, 23);
    validateInput("uminutebefore", 0, 59);
    validateInput("uhourafter", 0, 23);
    validateInput("uminuteafter", 0, 59);
    
    // Відновлення збережених налаштувань
    const savedTab = localStorage.getItem("activeTab") || "Schedule";
    const tabButton = Array.from(document.querySelectorAll('.tablinks'))
        .find(btn => btn.textContent === savedTab);
    if (tabButton) {
        tabButton.click();
    }

    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
        document.querySelector("body").classList.add("black-theme");
        document.getElementById("darkmode").checked = true;
    }
    
    // Запуск годинника
    startClock();
});

// ======== Event Listeners ========
window.addEventListener('load', () => {
    initWebSocket();
    setupManualControl();
});

// Обробка зміни checkbox для розкладів
document.addEventListener('change', function(e) {
    if (e.target.matches('input[type="checkbox"]') && 
        e.target.closest('.date-setted')) {
        sendSchedulesToESP();
    }
});

// Обробка форми статистики
document.addEventListener('DOMContentLoaded', () => {
    const statsForm = document.querySelector('.statistics-section-content-buttons');
    if (statsForm) {
        statsForm.addEventListener('submit', (event) => {
            event.preventDefault();
            
            const { from, to, valid } = getUnixTimeRangeFromInputs(
                'statsdateafter', 'statstimeafter',
                'statsdatebefore', 'statstimebefore'
            );
            
            if (!valid) {
                alert("⚠️ Перевірте правильність діапазону часу (від < до)");
                return;
            }
            
            drawBoilerLog(from, to);
        });
    }
});

// Обробка перемикача темної теми
document.addEventListener('DOMContentLoaded', () => {
    const darkmodeToggle = document.getElementById("darkmode");
    if (darkmodeToggle) {
        darkmodeToggle.addEventListener("change", chooseMode);
    }
});



*/
