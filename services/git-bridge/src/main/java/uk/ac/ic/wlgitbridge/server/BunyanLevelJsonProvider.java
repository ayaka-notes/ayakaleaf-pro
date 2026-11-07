package uk.ac.ic.wlgitbridge.server;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import com.fasterxml.jackson.core.JsonGenerator;
import java.io.IOException;
import net.logstash.logback.composite.AbstractFieldJsonProvider;

/** Writes log level as a bunyan-compatible numeric value. */
public class BunyanLevelJsonProvider extends AbstractFieldJsonProvider<ILoggingEvent> {

  @Override
  public void writeTo(JsonGenerator generator, ILoggingEvent event) throws IOException {
    generator.writeNumberField("level", toBunyanLevel(event.getLevel()));
  }

  private static int toBunyanLevel(Level level) {
    if (level.isGreaterOrEqual(Level.ERROR)) return 50;
    if (level.isGreaterOrEqual(Level.WARN)) return 40;
    if (level.isGreaterOrEqual(Level.INFO)) return 30;
    if (level.isGreaterOrEqual(Level.DEBUG)) return 20;
    return 10;
  }
}
