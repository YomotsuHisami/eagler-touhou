import {useParams} from 'react-router';
import {isProductId} from '../../src/contracts/product-catalog.mts';
import {ReplayFiles} from '../features/ReplayFiles';
import {ScoreLibrary} from '../features/ScoreLibrary';
export default function Replays(){const{productId=''}=useParams();return <section>{isProductId(productId)&&<ScoreLibrary productId={productId}/>}{isProductId(productId)&&<ReplayFiles productId={productId}/>}</section>;}
