Option Explicit
Dim files, shell, entry, launch
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
entry = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "tv-setup\server.mjs")
launch = "node.exe " & Chr(34) & entry & Chr(34) & " --open"
On Error Resume Next
shell.Run launch, 0, False
If Err.Number <> 0 Then
  MsgBox "TV Setup could not start. Install Node.js 22 or newer from nodejs.org, then try again.", vbExclamation, "Lanternfin TV Setup"
End If
