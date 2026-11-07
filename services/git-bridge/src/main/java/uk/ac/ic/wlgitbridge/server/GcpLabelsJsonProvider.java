package uk.ac.ic.wlgitbridge.server;

import ch.qos.logback.classic.spi.ILoggingEvent;
import com.fasterxml.jackson.core.JsonGenerator;
import java.io.IOException;
import net.logstash.logback.composite.AbstractFieldJsonProvider;
import net.logstash.logback.composite.JsonWritingUtils;

/** Writes projectId from MDC into logging.googleapis.com/labels so GCP Cloud Logging indexes it. */
public class GcpLabelsJsonProvider extends AbstractFieldJsonProvider<ILoggingEvent> {

  @Override
  public void writeTo(JsonGenerator generator, ILoggingEvent event) throws IOException {
    String projectId = event.getMDCPropertyMap().get("projectId");
    if (projectId == null || projectId.isEmpty()) {
      return;
    }
    generator.writeObjectFieldStart("logging.googleapis.com/labels");
    JsonWritingUtils.writeStringField(generator, "projectId", projectId);
    generator.writeEndObject();
  }
}
