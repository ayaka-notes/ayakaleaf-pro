on validToolkit(folderPath)
	try
		do shell script "test -x " & quoted form of (folderPath & "/bin/docker-compose") & " && test -f " & quoted form of (folderPath & "/config/overleaf.rc")
		return true
	on error
		return false
	end try
end validToolkit

on run
	try
		if (do shell script "/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true") is not "1" then error "This launcher requires an Apple Silicon Mac."
		set prefs to "space.ayaka.ayakaleaf.local-launcher"
		set folderPath to do shell script "/usr/bin/defaults read " & prefs & " ToolkitPath 2>/dev/null || true"
		if folderPath is "" or not my validToolkit(folderPath) then
			set folderPath to POSIX path of (choose folder with prompt "Choose your trusted, configured Ayakaleaf Toolkit folder (not the application source checkout).")
			if not my validToolkit(folderPath) then error "This folder does not contain a configured Toolkit installation."
			do shell script "/usr/bin/defaults write " & prefs & " ToolkitPath -string " & quoted form of folderPath
		end if
		set startScript to POSIX path of (path to resource "start.sh")
		set instanceURL to do shell script "/bin/bash " & quoted form of startScript & " " & quoted form of folderPath
		open location instanceURL
	on error errorText number errorNumber
		if errorNumber is not -128 then display alert "Ayakaleaf Pro could not start" message errorText as warning
	end try
end run
