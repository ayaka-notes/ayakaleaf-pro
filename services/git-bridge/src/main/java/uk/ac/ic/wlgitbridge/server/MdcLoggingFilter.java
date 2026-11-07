package uk.ac.ic.wlgitbridge.server;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.slf4j.MDC;
import uk.ac.ic.wlgitbridge.util.Util;

public class MdcLoggingFilter implements Filter {

  @Override
  public void init(FilterConfig filterConfig) {}

  @Override
  public void doFilter(
      ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain)
      throws IOException, ServletException {
    HttpServletRequest request = (HttpServletRequest) servletRequest;
    String[] parts = request.getRequestURI().split("/");
    if (parts.length > 1) {
      MDC.put("projectId", Util.removeAllSuffixes(parts[1], ".git"));
    }
    MDC.put("ip", Util.getClientIp(request));
    try {
      filterChain.doFilter(servletRequest, servletResponse);
    } finally {
      MDC.clear();
    }
  }

  @Override
  public void destroy() {}
}
