package uk.ac.ic.wlgitbridge.server;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.LoggerFactory;

public class GceMetadataLogLevelChecker {

  private static final Path TRACING_END_TIME_FILE = Path.of("/logging/tracingEndTime");
  private static final String METADATA_BASE =
      "http://metadata.google.internal/computeMetadata/v1/project/attributes/";

  private final Logger appLogger;
  private final Level defaultLevel;
  private final URI metadataUri;
  private final HttpClient httpClient;
  private final ScheduledExecutorService scheduler;

  public GceMetadataLogLevelChecker(String serviceName, Level defaultLevel) {
    this.appLogger = (Logger) LoggerFactory.getLogger("uk.ac.ic.wlgitbridge");
    this.defaultLevel = defaultLevel;
    this.metadataUri = URI.create(METADATA_BASE + serviceName + "-setLogLevelEndTime");
    this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    this.scheduler =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "log-level-checker");
              t.setDaemon(true);
              return t;
            });
  }

  public void start() {
    checkLogLevel();
    scheduler.scheduleAtFixedRate(this::checkLogLevel, 60, 60, TimeUnit.SECONDS);
  }

  public void stop() {
    scheduler.shutdown();
  }

  private void checkLogLevel() {
    try {
      long endTime = fetchTracingEndTime();
      if (endTime > System.currentTimeMillis()) {
        setLevel(Level.TRACE);
      } else {
        setLevel(defaultLevel);
      }
    } catch (Exception e) {
      appLogger.warn("Failed to fetch log level: {}", e.getMessage());
      setLevel(defaultLevel);
    }
  }

  private void setLevel(Level newLevel) {
    Level currentLevel = appLogger.getLevel();
    if (currentLevel == newLevel) return;
    appLogger.setLevel(newLevel);
    appLogger.info("Log level changed from {} to {}", currentLevel, newLevel);
  }

  private long fetchTracingEndTime() throws Exception {
    try {
      return Long.parseLong(Files.readString(TRACING_END_TIME_FILE).trim());
    } catch (IOException ignored) {
      // File not present; fall back to GCE project metadata
    }
    return fetchTracingEndTimeFromMetadata();
  }

  private long fetchTracingEndTimeFromMetadata() throws Exception {
    HttpRequest request =
        HttpRequest.newBuilder()
            .uri(metadataUri)
            .header("Metadata-Flavor", "Google")
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build();
    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() == 404) {
      return 0;
    }
    if (response.statusCode() != 200) {
      throw new Exception("Unexpected HTTP status: " + response.statusCode());
    }
    return Long.parseLong(response.body().trim());
  }
}
