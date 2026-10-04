/** CI-only loopback origins. Keep the plain preview separate from both real SW
 * publications. 4190 is browser-restricted (Firefox/WebKit evidence from
 * workflow37234481444); use an ordinary HTTP port without security overrides. */
const address = (port: number) => `http://127.0.0.1:${port}`;
export const previewFixture = Object.freeze({port:4178,origin:address(4178)});
export const publicationFixtures = Object.freeze([
 Object.freeze({name:'root',port:4191,origin:address(4191),controlPort:4193,controlOrigin:address(4193),mount:'/'}),
 Object.freeze({name:'nested',port:4192,origin:address(4192),controlPort:4194,controlOrigin:address(4194),mount:'/nested-launcher/'}),
]);
