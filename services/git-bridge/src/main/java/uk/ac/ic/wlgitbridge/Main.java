package uk.ac.ic.wlgitbridge;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import uk.ac.ic.wlgitbridge.application.GitBridgeApp;
import uk.ac.ic.wlgitbridge.util.Log;

/*
 * Created by Winston on 01/11/14.
 */

/*
 * This is the entry point into the Git Bridge.
 *
 * It is responsible for creating the {@link GitBridgeApp} and then running it.
 *
 * The {@link GitBridgeApp} parses args and creates the {@link GitBridgeServer}.
 *
 * The {@link GitBridgeServer} creates the {@link Bridge}, among other things.
 *
 * The {@link Bridge} is the heart of the Git Bridge. Start there, and follow
 * the links outwards (which lead back to the Git users and the postback from
 * the snapshot API) and inwards (which lead into the components of the Git
 * Bridge: the configurable repo store, db store, and swap store, along with
 * the project lock, the swap job, the snapshot API, the resource cache
 * and the postback manager).
 */
public class Main {

  public static void main(String[] args) {
    if ("gke".equals(System.getenv("LOGGING_FORMAT"))) {
      System.setProperty("logback.configurationFile", "logback-gke.xml");
    }
    String hostname = System.getenv("HOSTNAME");
    if (hostname == null || hostname.isEmpty()) {
      try {
        hostname = InetAddress.getLocalHost().getHostName();
      } catch (UnknownHostException e) {
        hostname = "unknown";
      }
    }
    System.setProperty("HOSTNAME", hostname);
    System.setProperty("PID", String.valueOf(ProcessHandle.current().pid()));
    Log.info("Git Bridge started with args: " + Arrays.toString(args));
    try {
      new GitBridgeApp(args).run();
    } catch (Throwable t) {
      /* So that we get a timestamp */
      Log.error("Fatal exception thrown to top level, exiting: ", t);
      System.exit(1);
    }
  }
}
