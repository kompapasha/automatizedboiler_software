#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <SPIFFS.h>
#include "time.h"
#include <ArduinoJson.h>

// ======== Конфігурація мережі ========
const char* ssid = "MyNetwork";         //MyNetwork
const char* password = "11111111";     //11111111

// ======== Конфігурація часу ========
const char* ntpServer = "pool.ntp.org";
long userTimezoneOffset_sec = 0;
const int daylightOffset_sec = 0;

// ======== Налаштування пінів та інтервалів ========
const int ledPin = 2;
const unsigned long ntpSyncInterval = 5 * 60 * 1000; // 5 хвилин
const unsigned long checkInterval = 1000; // 1 секунда

// ======== Стан системи ========
bool manualControl = false;
bool lastScheduleStatus = false;
unsigned long lastNtpSync = 0;
unsigned long lastCheck = 0;
bool lastRelayState = false;

// ======== Сервер та WebSocket ========
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ======== Структури даних ========
struct Schedule {
  int id;
  bool active;
  int beforeHour;
  int beforeMinute;
  int afterHour;
  int afterMinute;
};

struct BoilerLogEntry {
  time_t timestamp;
  bool state;
};

std::vector<Schedule> schedules;
std::vector<BoilerLogEntry> boilerLog;

// ======== Утилітарні функції ========
void logBoilerState(bool state) {
  boilerLog.push_back({time(nullptr), state});
  
  // Обмежуємо розмір логу (зберігаємо останні 1000 записів)
  if (boilerLog.size() > 1000) {
    boilerLog.erase(boilerLog.begin(), boilerLog.begin() + 100);
  }
  
  // Зберігаємо у файл тільки якщо стан змінився
  File file = SPIFFS.open("/boiler_log.json", FILE_WRITE);
  if (file) {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (auto& entry : boilerLog) {
      JsonObject obj = arr.createNestedObject();
      obj["timestamp"] = entry.timestamp;
      obj["state"] = entry.state;
    }
    serializeJson(doc, file);
    file.close();
  }
}

void setRelayState(bool state, const char* reason) {
  bool currentState = digitalRead(ledPin) == HIGH;
  if (currentState != state) {
    digitalWrite(ledPin, state ? HIGH : LOW);
    logBoilerState(state);
    Serial.printf("%s Relay turned %s (%s)\n", 
                  state ? "⚡️" : "⛔", 
                  state ? "ON" : "OFF", 
                  reason);
    lastRelayState = state;
    broadcastStatus();
  }
}

void broadcastStatus() {
  bool relayState = digitalRead(ledPin) == HIGH;
  
  JsonDocument doc;
  doc["type"] = "boilerStatus";
  doc["boilerState"] = relayState;  // Статус = реальний стан реле
  doc["manualControl"] = manualControl;
  doc["scheduleActive"] = lastScheduleStatus;
  
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

bool isInTimeRange(int currentHour, int currentMinute, const Schedule& s) {
  int current = currentHour * 60 + currentMinute;
  int start = s.beforeHour * 60 + s.beforeMinute;
  int end = s.afterHour * 60 + s.afterMinute;
  
  return (start <= end) ? 
    (current >= start && current < end) : 
    (current >= start || current < end);
}

// ======== Робота з файлами SPIFFS ========
void saveSchedulesToFile() {
  File file = SPIFFS.open("/schedules.json", FILE_WRITE);
  if (!file) return;
  
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (auto& s : schedules) {
    JsonObject obj = arr.add<JsonObject>();
    obj["id"] = s.id;
    obj["active"] = s.active;
    obj["before"]["hour"] = s.beforeHour;
    obj["before"]["minute"] = s.beforeMinute;
    obj["after"]["hour"] = s.afterHour;
    obj["after"]["minute"] = s.afterMinute;
  }
  serializeJson(doc, file);
  file.close();
}

void loadSchedulesFromFile() {
  File file = SPIFFS.open("/schedules.json", FILE_READ);
  if (!file || file.isDirectory()) {
    Serial.println("ℹ️ No saved schedules found");
    return;
  }
  
  JsonDocument doc;
  if (deserializeJson(doc, file) == DeserializationError::Ok) {
    schedules.clear();
    for (JsonObject sch : doc.as<JsonArray>()) {
      Schedule s;
      s.id = sch["id"].as<int>();
      s.active = sch["active"];
      s.beforeHour = sch["before"]["hour"];
      s.beforeMinute = sch["before"]["minute"];
      s.afterHour = sch["after"]["hour"];
      s.afterMinute = sch["after"]["minute"];
      schedules.push_back(s);
    }
  }
  file.close();
}

void loadBoilerLogFromFile() {
  File file = SPIFFS.open("/boiler_log.json", FILE_READ);
  if (!file || file.isDirectory()) {
    Serial.println("ℹ️ No boiler log file found");
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, file) == DeserializationError::Ok) {
    boilerLog.clear();
    for (JsonObject obj : doc.as<JsonArray>()) {
      BoilerLogEntry entry;
      entry.timestamp = obj["timestamp"];
      entry.state = obj["state"];
      boilerLog.push_back(entry);
    }
  }
  file.close();
}

// ======== WebSocket обробники ========
void handleSchedulesUpdate(JsonDocument& doc) {
  schedules.clear();
  for (JsonObject sch : doc["payload"].as<JsonArray>()) {
    Schedule s;
    s.id = sch["id"].as<int>();
    s.active = sch["active"];
    s.beforeHour = sch["before"]["hour"];
    s.beforeMinute = sch["before"]["minute"];
    s.afterHour = sch["after"]["hour"];
    s.afterMinute = sch["after"]["minute"];
    schedules.push_back(s);
  }
  saveSchedulesToFile();
  
  // Відповідь клієнту
  JsonDocument outDoc;
  JsonArray arr = outDoc.createNestedArray("data");
  for (auto& s : schedules) {
    JsonObject obj = arr.createNestedObject();
    obj["id"] = s.id;
    obj["active"] = s.active;
    obj["before"]["hour"] = s.beforeHour;
    obj["before"]["minute"] = s.beforeMinute;
    obj["after"]["hour"] = s.afterHour;
    obj["after"]["minute"] = s.afterMinute;
  }
  outDoc["type"] = "schedule";
  
  String response;
  serializeJson(outDoc, response);
  ws.textAll(response);
}

void handleBoilerStatsRequest(JsonDocument& doc) {
  time_t from = doc["from"];
  time_t to = doc["to"];

  JsonDocument outDoc;
  JsonArray arr = outDoc.createNestedArray("stats");

  for (auto& entry : boilerLog) {
    if (entry.timestamp >= from && entry.timestamp <= to) {
      JsonObject obj = arr.createNestedObject();
      obj["timestamp"] = entry.timestamp;
      obj["state"] = entry.state;
    }
  }

  outDoc["type"] = "boilerStats";
  outDoc["from"] = from;
  outDoc["to"] = to;

  String response;
  serializeJson(outDoc, response);
  ws.textAll(response);
}

void sendScheduleToClient() {
  JsonDocument outDoc;
  JsonArray arr = outDoc.createNestedArray("data");

  for (auto& s : schedules) {
    JsonObject obj = arr.createNestedObject();
    obj["id"] = s.id;
    obj["active"] = s.active;
    obj["before"]["hour"] = s.beforeHour;
    obj["before"]["minute"] = s.beforeMinute;
    obj["after"]["hour"] = s.afterHour;
    obj["after"]["minute"] = s.afterMinute;
  }

  outDoc["type"] = "schedule";
  String response;
  serializeJson(outDoc, response);
  ws.textAll(response);
}

void handleWebSocketMessage(void *arg, uint8_t *data, size_t len) {
  AwsFrameInfo *info = (AwsFrameInfo*)arg;
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
    data[len] = 0;
    JsonDocument doc;
    
    if (deserializeJson(doc, (char*)data) != DeserializationError::Ok) {
      Serial.println("❌ Failed to parse WS message");
      return;
    }

    String type = doc["type"];
    
    if (type == "schedules") {
      handleSchedulesUpdate(doc);
    }
    else if (type == "getBoilerStats") {
      handleBoilerStatsRequest(doc);
    }
    else if (type == "getSchedule") {
      sendScheduleToClient();
    }
    else if (type == "manualControl") {
      manualControl = doc["enabled"];
      Serial.printf("📥 Manual control: %s\n", manualControl ? "ON" : "OFF");
      setRelayState(manualControl, "manual");
    }
    else if (type == "setTimezone") {
      int offsetMin = doc["timezoneOffset"];
      userTimezoneOffset_sec = offsetMin * 60;
      configTime(userTimezoneOffset_sec, daylightOffset_sec, ntpServer);
      Serial.printf("🌍 Timezone offset: %d min\n", offsetMin);
    }
    else if (type == "clearSchedule") {
      Serial.println("🗑️ Clearing schedule");
      if (SPIFFS.exists("/schedules.json")) {
        SPIFFS.remove("/schedules.json");
      }
      schedules.clear();
    }
    //else if (type == "toggleManualRelay") {
    //  if (manualControl) {
    //    manualRelayState = !manualRelayState;
    //    Serial.printf("🎛️ Manual relay toggled: %s\n", manualRelayState ? "ON" : "OFF");
    //    broadcastStatus();
    //  }
    //}
  }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
             AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("WebSocket client #%u connected\n", client->id());
      broadcastStatus();
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("WebSocket client #%u disconnected\n", client->id());
      break;
    case WS_EVT_DATA:
      handleWebSocketMessage(arg, data, len);
      break;
    default:
      break;
  }
}

// ======== Ініціалізація ========
void initWebSocket() {
  ws.onEvent(onEvent);
  server.addHandler(&ws);
}

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

  // WiFi підключення
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("✅ Wi-Fi connected!");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());

  // SPIFFS ініціалізація
  if (!SPIFFS.begin(true)) {
    Serial.println("❌ SPIFFS mount failed!");
    return;
  }

  // Завантаження даних
  loadSchedulesFromFile();
  loadBoilerLogFromFile();

  // Налаштування часу
  configTime(userTimezoneOffset_sec, daylightOffset_sec, ntpServer);
  lastNtpSync = millis();

  // WebSocket та HTTP сервер
  initWebSocket();
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/main.html", "text/html");
  });
  server.serveStatic("/", SPIFFS, "/");
  server.begin();
  
  Serial.println("🚀 HTTP server started");
}

// ======== Основний цикл ========
void loop() {
  ws.cleanupClients();

  // Перевірка розкладу та керування реле
  if (millis() - lastCheck > checkInterval) {
    lastCheck = millis();

    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      bool shouldBeOn = false;
      bool scheduleActive = false;

      // Перевірка активних розкладів
      for (const auto& s : schedules) {
        if (s.active && isInTimeRange(timeinfo.tm_hour, timeinfo.tm_min, s)) {
          shouldBeOn = true;
          scheduleActive = true;
          break;
        }
      }

      // Оновлення статусу розкладу
      if (scheduleActive != lastScheduleStatus) {
        lastScheduleStatus = scheduleActive;
        Serial.printf("📅 Schedule status changed: %s\n", scheduleActive ? "ACTIVE" : "INACTIVE");
      }

      // Спрощена логіка керування реле
      if (scheduleActive) {
        setRelayState(true, "schedule");
      } else if (manualControl) {
        setRelayState(true, "manual");
      } else {
        setRelayState(false, "auto off");
      }
    }
  }

  // Синхронізація NTP
  if (millis() - lastNtpSync > ntpSyncInterval) {
    Serial.println("🔄 Syncing time...");
    configTime(userTimezoneOffset_sec, daylightOffset_sec, ntpServer);
    lastNtpSync = millis();
  }
}



/*
  !!!13. Додати отримання часового поясу та передати значення в сервер
  +!!!14. Виправити синхронізацію збережених записів
  +!!!15. Створити вкладку "History", яка буде відображати графік робіт бойлера.
  !!!16. Додати еко режим (вмк ьойлер не за графіком, а за Чекбоксом)

  
  !5. MobileWeb
  +!7. При відкритті POPUP оновлювати час 
  +!8. Статус Бойлера
  +!12. Змінити спосіб збереження дат

  
  2. Додати функціонал видалення всіх записів
  10. Додаткові опції в Налаштуваннях (наприклад, зміна на темний фон)
  11. Змінити стиль кнопки в Pop Up


  +1. Додати LocalStorage (?) (чи Додати збереження в файл SPIFFS)
  -4. Опція зміни часого поясу (?)
   9. Додати вкладку з годинником (?)


Стаття
1. Вступ 1-2стор
  1.1 Сьогоднішня ситуація в енергосистеиі.
  1.2 Зовнішні чинники, які діють на енергосистему 
    - зношеність, природні чинники, бойові дії
  1.3 Які є можливості для стабілізації
      маневрові потуж., перенесення піків споживання на період доби.
  Висновок: Перенесення і визначає актуальність теми. Мета
2. Огляд літератури 1-1.5стор
  2.1 Можливість стабілізації (за анотаціями) -- 7-8 джерел
3. Основна частина 2-
  ...
4. 
  

*/
