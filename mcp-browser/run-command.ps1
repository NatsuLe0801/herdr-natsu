$Command = $args[0]
$CommandArgs = @($args | Select-Object -Skip 1)

& $Command @CommandArgs
exit $LASTEXITCODE
