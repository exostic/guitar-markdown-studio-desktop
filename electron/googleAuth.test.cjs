const test = require('node:test');
const assert = require('node:assert/strict');
// `electron` is not available under plain Node: stub the one name the module reads.
require.cache[require.resolve('electron')] = { exports: { shell: { openExternal: () => {} } } };
const { parseFragment, REDIRECT_URI } = require('./googleAuth.cjs');

test("le fragment renvoyé par Google donne le jeton, sa durée et l'état", () => {
  assert.deepEqual(parseFragment('#state=abc&access_token=ya29.x&token_type=Bearer&expires_in=3599&scope=drive'), {
    state: 'abc', access_token: 'ya29.x', token_type: 'Bearer', expires_in: '3599', scope: 'drive',
  });
  assert.deepEqual(parseFragment('error=access_denied&state=abc'), { error: 'access_denied', state: 'abc' });
  assert.equal(REDIRECT_URI, 'http://localhost:43110/');
});

test('le flux de bureau reçoit le jeton renvoyé sur localhost:43110', async () => {
  const electron = require.cache[require.resolve('electron')].exports;
  // A "browser" that, given Google's URL, answers as Google would: redirect
  // to the loopback address with the token in the fragment. The relay page
  // there forwards the fragment to /token, which is what we do directly.
  electron.shell.openExternal = async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('response_type'), 'token');
    assert.equal(params.get('redirect_uri'), REDIRECT_URI);
    assert.equal(params.get('client_id'), 'public-id');
    const page = await fetch(REDIRECT_URI);
    assert.match(await page.text(), /location\.hash/);
    await fetch(`${REDIRECT_URI}token?state=${params.get('state')}&access_token=ya29.test&expires_in=3599`);
  };
  const { googleAuth } = require('./googleAuth.cjs');
  const result = await googleAuth({ clientId: 'public-id', scopes: 'drive' });
  assert.deepEqual(result, { accessToken: 'ya29.test', expiresIn: 3599 });
});
