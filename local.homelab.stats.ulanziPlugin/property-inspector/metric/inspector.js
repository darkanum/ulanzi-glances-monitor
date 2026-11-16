let form = null;

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  form.addEventListener(
    'input',
    Utils.debounce(() => $UD.sendParamFromPlugin(Utils.getFormValue(form)))
  );
});

function loadSettings(jsn) {
  if (jsn && jsn.param && form) Utils.setFormValue(jsn.param, form);
}

$UD.onAdd(loadSettings);
$UD.onParamFromApp(loadSettings);
